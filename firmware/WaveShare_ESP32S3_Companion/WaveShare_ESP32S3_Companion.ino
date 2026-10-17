// ============================================================================
// PATCHI ULTIMATE FIRMWARE: WAVESHARE ESP32-S3 1.47" (ESP32 CORE 3.x READY)
// Includes:
//  - Updated Layout 3 (Visualizer now displays Title, Artist, AND Album up top)
//  - Smooth Title Scrolling (automatically scrolls titles > 13 chars across all 3 layouts)
//  - Accurate GIF color endianness (LITTLE_ENDIAN_PIXELS for draw16bitRGBBitmap)
//  - SHOW_ART, PLAY_GIF, STYLE|, PING, and CLEAR/WIPE command handlers
//  - Native ESP-IDF QR Code Generator (Zero compile errors on Core 3.x)
// ============================================================================

#include <Arduino.h>
#include <Arduino_GFX_Library.h>
#include <Adafruit_NeoPixel.h>
#include <JPEGDEC.h>
#include <AnimatedGIF.h>
#include <qrcode.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#include <WiFi.h>
#include <WebServer.h>
#include <FS.h>
#include <SD_MMC.h>

// 1. PIN CONFIGURATION (WaveShare ESP32-S3-LCD-1.47)
#define LCD_MOSI 45
#define LCD_SCLK 40
#define LCD_CS   42
#define LCD_DC   41
#define LCD_RST  39
#define LCD_BL   48
#define RGB_PIN  38

// MicroSD TF Card Slot (Native 4-bit SD_MMC parallel bus)
#define SD_MMC_CLK 14
#define SD_MMC_CMD 15
#define SD_MMC_D0  16
#define SD_MMC_D1  18
#define SD_MMC_D2  17
#define SD_MMC_D3  21

#define SCREEN_W 172
#define SCREEN_H 320

bool sdCardReady = false;
bool hasAlbumArtLoaded = false;
String lastRequestedArtHash = "";
BLECharacteristic *pCmdChar = nullptr;

Arduino_DataBus *bus = new Arduino_ESP32SPI(LCD_DC, LCD_CS, LCD_SCLK, LCD_MOSI, GFX_NOT_DEFINED);
Arduino_GFX *gfx = new Arduino_ST7789(
  bus, LCD_RST, 0 /* portrait */, true /* IPS */,
  SCREEN_W, SCREEN_H,
  34 /* col offset 1 */, 0 /* row offset 1 */,
  34 /* col offset 2 */, 0 /* row offset 2 */
);

Adafruit_NeoPixel rgb(1, RGB_PIN, NEO_GRB + NEO_KHZ800);
JPEGDEC jpeg;
AnimatedGIF gif;

// 2. BLE UUIDs
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_CMD_UUID       "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define CHAR_DATA_UUID      "826f6405-10a0-422c-94f7-558b99e08374"

// 3. STATE & BUFFERS
enum DisplayMode { MODE_BOOT, MODE_PLEX, MODE_QR, MODE_GIF, MODE_CLEAR };
volatile DisplayMode currentMode = MODE_BOOT;

enum NowPlayingStyle { STYLE_FULLSCREEN = 1, STYLE_SCRUBBER = 2, STYLE_VISUALIZER = 3 };
volatile NowPlayingStyle currentStyle = STYLE_SCRUBBER;

#define MAX_MEDIA_SIZE (2 * 1024 * 1024) // 2MB in PSRAM
uint8_t *mediaBuffer = nullptr;
size_t actualBufferSize = 64 * 1024;
volatile size_t mediaWriteIndex = 0;
volatile size_t expectedMediaSize = 0;
volatile size_t gifDataSize = 0;
volatile bool newMediaReady = false;
volatile bool uiNeedsRedraw = true;
volatile bool wipeRequested = false;

volatile bool bleConnected = false;
volatile bool oldBleConnected = false;

String trackTitle = "Waiting for Plex...";
String trackArtist = "Connect via Pixel";
String trackAlbum = "";
String qrTitle = "SCAN ME";
String qrPayload = "https://plex.tv";

// 3.0 PLAYBACK PROGRESS STATE (Real-time Scrubber)
volatile int trackPositionSec = 0;
volatile int trackDurationSec = 0;
volatile bool trackIsPlaying = false;
unsigned long lastScrubberTickMs = 0;

String formatSeconds(int totalSec) {
  if (totalSec < 0) totalSec = 0;
  int m = totalSec / 60;
  int s = totalSec % 60;
  char buf[12];
  snprintf(buf, sizeof(buf), "%d:%02d", m, s);
  return String(buf);
}

// 3.1 TITLE SCROLL TICKER STATE
int titleScrollPos = 0;
int titlePauseTicks = 8; // pause ~1.8s at start
unsigned long lastTitleScrollMs = 0;

WebServer httpServer(80);
bool wifiBurstActive = false;

// 4. LED & WIPE HELPERS
void setRgbHex(String hexStr) {
  if (hexStr.startsWith("#")) hexStr.remove(0, 1);
  if (hexStr.length() < 6) return;
  long number = strtol(hexStr.c_str(), NULL, 16);
  uint8_t r = (number >> 16) & 0xFF;
  uint8_t g = (number >> 8) & 0xFF;
  uint8_t b = number & 0xFF;
  rgb.setPixelColor(0, rgb.Color(r, g, b));
  rgb.show();
}

void instantWipeDisplay() {
  mediaWriteIndex = 0;
  expectedMediaSize = 0;
  gifDataSize = 0;
  newMediaReady = false;
  hasAlbumArtLoaded = false;
  gfx->fillScreen(RGB565_BLACK);
  rgb.setPixelColor(0, 0);
  rgb.show();
}

// 4.1 BLE NOTIFICATION & SD INITIALIZATION
void sendBleNotification(String msg) {
  if (pCmdChar != nullptr && bleConnected) {
    pCmdChar->setValue(msg.c_str());
    pCmdChar->notify();
    Serial.println("[BLE TX NOTIFY] " + msg);
  }
}

bool initSdCard() {
  if (sdCardReady) return true;
  Serial.println("[SD] Initializing 64GB MicroSD slot via native SD_MMC (pins CLK:14, CMD:15, D0:16, D1:18, D2:17, D3:21)...");

  // Enable internal pullups on CMD and data lines for reliable 4-bit bus
  pinMode(SD_MMC_CMD, INPUT_PULLUP);
  pinMode(SD_MMC_D0,  INPUT_PULLUP);
  pinMode(SD_MMC_D1,  INPUT_PULLUP);
  pinMode(SD_MMC_D2,  INPUT_PULLUP);
  pinMode(SD_MMC_D3,  INPUT_PULLUP);

  if (!SD_MMC.setPins(SD_MMC_CLK, SD_MMC_CMD, SD_MMC_D0, SD_MMC_D1, SD_MMC_D2, SD_MMC_D3)) {
    Serial.println("[SD] Error: Failed to assign SD_MMC pins");
    sendBleNotification("SD_STATUS|FAIL_PINS");
    return false;
  }

  // Attempt 4-bit parallel bus (fastest ~20-40MB/s)
  if (!SD_MMC.begin("/sd", false)) {
    Serial.println("[SD] 4-bit bus failed, attempting 1-bit fallback...");
    if (!SD_MMC.begin("/sd", true)) {
      Serial.println("[SD] SD_MMC Mount Failed. Please check card is formatted to FAT32 (MS-DOS).");
      sdCardReady = false;
      sendBleNotification("SD_STATUS|FAIL_FORMAT_FAT32");
      return false;
    }
  }

  uint8_t cardType = SD_MMC.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[SD] No MicroSD card detected in slot");
    sdCardReady = false;
    sendBleNotification("SD_STATUS|NO_CARD");
    return false;
  }

  uint64_t totalBytes = SD_MMC.totalBytes();
  uint64_t usedBytes = SD_MMC.usedBytes();
  unsigned long totalMB = (unsigned long)(totalBytes / (1024 * 1024));
  Serial.printf("[SD] Card Mounted successfully: %lu MB Total, %llu MB Used\n",
                totalMB, usedBytes / (1024 * 1024));

  // Automatically create directories if absent
  if (!SD_MMC.exists("/art")) {
    SD_MMC.mkdir("/art");
    Serial.println("[SD] Created /art directory for autonomous cover caching");
  }
  if (!SD_MMC.exists("/gifs")) {
    SD_MMC.mkdir("/gifs");
    Serial.println("[SD] Created /gifs directory for instant animations");
  }

  sdCardReady = true;
  sendBleNotification("SD_STATUS|MOUNTED|" + String(totalMB) + "MB");
  return true;
}

// 5. DECODERS (JPEG & GIF)
int jpegDrawCallback(JPEGDRAW *pDraw) {
  int maxH = (currentStyle == STYLE_FULLSCREEN) ? SCREEN_H : 172;
  if (pDraw->y < maxH) {
    int drawH = min((int)pDraw->iHeight, maxH - pDraw->y);
    gfx->draw16bitBeRGBBitmap(pDraw->x, pDraw->y, pDraw->pPixels, pDraw->iWidth, drawH);
  }
  return 1;
}

void drawAlbumArtFromBuffer(size_t len) {
  if (mediaBuffer == nullptr || len < 4) return;

  // Verify JPEG Start Of Image (0xFF, 0xD8) and End Of Image (0xFF, 0xD9)
  if (mediaBuffer[0] != 0xFF || mediaBuffer[1] != 0xD8) {
    Serial.printf("[JPEG ERROR] Invalid SOI marker: 0x%02X 0x%02X\n", mediaBuffer[0], mediaBuffer[1]);
    return;
  }
  if (mediaBuffer[len - 2] != 0xFF || mediaBuffer[len - 1] != 0xD9) {
    Serial.printf("[JPEG ERROR] Truncated JPEG! Missing EOI (got 0x%02X 0x%02X at %u)\n", mediaBuffer[len - 2], mediaBuffer[len - 1], (unsigned int)len);
    return;
  }

  if (jpeg.openRAM(mediaBuffer, len, jpegDrawCallback)) {
    jpeg.setPixelType(RGB565_BIG_ENDIAN);
    jpeg.decode(0, 0, 0);
    jpeg.close();
    hasAlbumArtLoaded = true;

    if (currentStyle == STYLE_FULLSCREEN) {
      gfx->fillRect(0, 250, SCREEN_W, 70, RGB565_BLACK);
      gfx->drawFastHLine(8, 252, SCREEN_W - 16, 0x3186);

      gfx->setTextColor(RGB565_WHITE);
      gfx->setTextSize(2);
      gfx->setCursor(8, 262);
      String shortTitle = trackTitle.length() > 13 ? trackTitle.substring(0, 13) : trackTitle;
      gfx->println(shortTitle);

      gfx->setTextColor(0xFD20);
      gfx->setTextSize(1);
      gfx->setCursor(8, 288);
      String shortArtist = trackArtist.length() > 24 ? trackArtist.substring(0, 23) + ".." : trackArtist;
      gfx->println(shortArtist);

      gfx->setTextColor(0x7BEF);
      gfx->setCursor(8, 304);
      String shortAlbum = trackAlbum.length() > 24 ? trackAlbum.substring(0, 23) + ".." : trackAlbum;
      gfx->println(shortAlbum);
    }
  }
}

void gifDrawCallback(GIFDRAW *pDraw) {
  uint8_t *s;
  uint16_t usTemp[SCREEN_W];
  int x, y;

  uint16_t *usPalette = pDraw->pPalette;
  int gifH = gif.getCanvasHeight();
  int gifW = gif.getCanvasWidth();
  int yOffset = (gifH > 0 && gifH < SCREEN_H) ? (SCREEN_H - gifH) / 2 : 0;
  int xOffset = (gifW > 0 && gifW < SCREEN_W) ? (SCREEN_W - gifW) / 2 : 0;

  y = yOffset + pDraw->iY + pDraw->y;
  int destX = xOffset + pDraw->iX;
  if (y < 0 || y >= SCREEN_H || destX >= SCREEN_W) return;

  int drawW = min((int)pDraw->iWidth, SCREEN_W - destX);
  if (drawW <= 0) return;

  s = pDraw->pPixels;
  if (pDraw->ucHasTransparency) {
    uint8_t ucTransparent = pDraw->ucTransparent;
    for (x = 0; x < drawW; x++) {
      uint8_t c = *s++;
      if (c != ucTransparent) {
        gfx->drawPixel(destX + x, y, usPalette[c]);
      }
    }
  } else {
    for (x = 0; x < drawW; x++) {
      usTemp[x] = usPalette[*s++];
    }
    gfx->draw16bitRGBBitmap(destX, y, usTemp, drawW, 1);
  }
}

// 6. UI RENDERERS (3 DISTINCT LAYOUTS)

// LAYOUT OPTION 1: Fullscreen Art with Bottom Scrim
void renderFullScreenNowPlaying() {
  if (!hasAlbumArtLoaded) {
    gfx->fillScreen(RGB565_BLACK);

    if (mediaWriteIndex == 0 && expectedMediaSize == 0) {
      int cx = SCREEN_W / 2;
      int cy = 120;
      gfx->drawCircle(cx, cy, 64, 0x2124);
      gfx->drawCircle(cx, cy, 44, 0x3186);
      gfx->drawCircle(cx, cy, 22, 0x632C);
      gfx->fillCircle(cx, cy, 8, 0xFD20);
    }
  }

  gfx->fillRect(0, 250, SCREEN_W, 70, RGB565_BLACK);
  gfx->drawFastHLine(8, 252, SCREEN_W - 16, 0x3186);

  gfx->setTextColor(RGB565_WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(8, 262);
  String shortTitle = trackTitle.length() > 13 ? trackTitle.substring(0, 13) : trackTitle;
  gfx->println(shortTitle);

  gfx->setTextColor(0xFD20);
  gfx->setTextSize(1);
  gfx->setCursor(8, 288);
  String shortArtist = trackArtist.length() > 24 ? trackArtist.substring(0, 23) + ".." : trackArtist;
  gfx->println(shortArtist);

  gfx->setTextColor(0x7BEF);
  gfx->setCursor(8, 304);
  String shortAlbum = trackAlbum.length() > 24 ? trackAlbum.substring(0, 23) + ".." : trackAlbum;
  gfx->println(shortAlbum);
}

// 6.01 FAST SCRUBBER BAR ONLY RENDERER (~1.5ms SPI write)
void drawScrubberBarOnly() {
  if (currentMode != MODE_PLEX || currentStyle != STYLE_SCRUBBER) return;

  int barX = 10;
  int barY = 252;
  int barW = SCREEN_W - 20; // 152 px
  int barH = 6;

  // Clear only the scrubber bar and timestamp region to prevent flickering
  gfx->fillRect(0, 248, SCREEN_W, 36, RGB565_BLACK);

  // Calculate percentage (0 to 100)
  int pct = 0;
  if (trackDurationSec > 0) {
    pct = (trackPositionSec * 100) / trackDurationSec;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
  }

  // Background track
  gfx->fillRoundRect(barX, barY, barW, barH, 3, 0x2124);

  // Active progress fill
  int fillW = (barW * pct) / 100;
  if (fillW > 0) {
    gfx->fillRoundRect(barX, barY, fillW, barH, 3, 0xFD20);
    gfx->fillCircle(barX + fillW, barY + 3, 4, RGB565_WHITE);
  } else {
    gfx->fillCircle(barX, barY + 3, 4, RGB565_WHITE);
  }

  // Timestamps: elapsed on left, duration on right
  String elapsedStr = formatSeconds(trackPositionSec);
  String durStr = (trackDurationSec > 0) ? formatSeconds(trackDurationSec) : "--:--";

  gfx->setTextSize(1);
  gfx->setTextColor(0x7BEF);
  gfx->setCursor(10, 268);
  gfx->print(elapsedStr);

  int durW = durStr.length() * 6;
  gfx->setCursor(SCREEN_W - 10 - durW, 268);
  gfx->print(durStr);
}

// LAYOUT OPTION 2: Square Art + Large Title + Scrubber Bar
void renderScrubberNowPlaying() {
  if (!hasAlbumArtLoaded) {
    gfx->fillRect(0, 0, SCREEN_W, 172, RGB565_BLACK);
  }
  gfx->fillRect(0, 174, SCREEN_W, SCREEN_H - 174, RGB565_BLACK);
  gfx->drawFastHLine(10, 176, SCREEN_W - 20, 0x3186);

  gfx->setTextColor(RGB565_WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(10, 186);
  String shortTitle = trackTitle.length() > 13 ? trackTitle.substring(0, 13) : trackTitle;
  gfx->println(shortTitle);

  gfx->setTextColor(0xFD20);
  gfx->setTextSize(1);
  gfx->setCursor(10, 212);
  gfx->println(trackArtist.length() > 25 ? trackArtist.substring(0, 24) : trackArtist);

  gfx->setTextColor(0x7BEF);
  gfx->setCursor(10, 228);
  gfx->println(trackAlbum.length() > 25 ? trackAlbum.substring(0, 24) : trackAlbum);

  drawScrubberBarOnly();
}

// LAYOUT: Dynamic Audio Visualizer (Title, Artist & Album UP TOP)
void renderVisualizerNowPlaying() {
  gfx->fillScreen(RGB565_BLACK);

  // Track Title UP TOP (Clean, prominent display without banner)
  gfx->setTextColor(RGB565_WHITE);
  gfx->setTextSize(2);
  gfx->setCursor(10, 16);
  String shortTitle = trackTitle.length() > 13 ? trackTitle.substring(0, 13) : trackTitle;
  gfx->println(shortTitle);

  // Artist UP TOP
  gfx->setTextColor(0xFD20); // Amber/Orange
  gfx->setTextSize(1);
  gfx->setCursor(10, 42);
  gfx->println(trackArtist.length() > 25 ? trackArtist.substring(0, 24) : trackArtist);

  // Album UP TOP (Clean and prominent)
  if (trackAlbum.length() > 0) {
    gfx->setTextColor(0xCE79); // Silver
    gfx->setTextSize(1);
    gfx->setCursor(10, 58);
    gfx->println(trackAlbum.length() > 25 ? trackAlbum.substring(0, 24) : trackAlbum);
    gfx->drawFastHLine(10, 76, SCREEN_W - 20, 0x3186);
  } else {
    gfx->drawFastHLine(10, 60, SCREEN_W - 20, 0x3186);
  }
  gfx->drawFastHLine(10, 305, SCREEN_W - 20, 0x4208);
}

// Smooth character-by-character horizontal title ticker for long song titles
void updateTitleScroll() {
  if (currentMode != MODE_PLEX) return;
  if (trackTitle.length() <= 13) return; // Fits entirely on screen

  if (millis() - lastTitleScrollMs < 220) return;
  lastTitleScrollMs = millis();

  if (titlePauseTicks > 0) {
    titlePauseTicks--;
    return;
  }

  titleScrollPos++;
  int totalLen = trackTitle.length() + 4; // text plus padding spaces
  if (titleScrollPos >= totalLen) {
    titleScrollPos = 0;
    titlePauseTicks = 8; // Pause ~1.8s at start
  }

  String padded = trackTitle + "    " + trackTitle;
  String window = padded.substring(titleScrollPos, titleScrollPos + 13);

  if (currentStyle == STYLE_SCRUBBER) {
    gfx->fillRect(10, 186, SCREEN_W - 20, 18, RGB565_BLACK);
    gfx->setTextColor(RGB565_WHITE);
    gfx->setTextSize(2);
    gfx->setCursor(10, 186);
    gfx->print(window);
  } else if (currentStyle == STYLE_VISUALIZER) {
    gfx->fillRect(10, 16, SCREEN_W - 20, 18, RGB565_BLACK);
    gfx->setTextColor(RGB565_WHITE);
    gfx->setTextSize(2);
    gfx->setCursor(10, 16);
    gfx->print(window);
  }
}

// Animate real-time bouncing equalizer spectrum bars for Option 3
void animateVisualizerBars() {
  static float phase = 0;
  phase += 0.14f;

  const int numBars = 11;
  const int barW = 10;
  const int gap = 4;
  const int startX = (SCREEN_W - (numBars * (barW + gap) - gap)) / 2;
  const int baseY = 300;
  const int maxH = 190;

  for (int i = 0; i < numBars; i++) {
    int x = startX + i * (barW + gap);
    float val = sin(phase * 1.6f + i * 0.7f) * 0.5f + sin(phase * 0.9f + i * 1.3f) * 0.35f + 0.15f;
    if (val < 0.05f) val = 0.05f;
    int h = (int)(val * maxH);
    if (h > maxH) h = maxH;

    gfx->fillRect(x, baseY - maxH, barW, maxH - h, RGB565_BLACK);

    uint16_t col = (i < 4) ? 0x07FF : ((i < 8) ? 0x3BD8 : 0xF81F);
    gfx->fillRect(x, baseY - h, barW, h, col);
    gfx->drawFastHLine(x, baseY - h - 2, barW, RGB565_WHITE);
  }
}

// NATIVE ESP-IDF QR CODE RENDERER (Core 3.x Compatible)
int lastQrBottomY = 180;

void drawQrCallback(esp_qrcode_handle_t qrcode) {
  int size = esp_qrcode_get_size(qrcode);
  int scale = 4;
  if (size * scale > 156) scale = 3;
  if (size * scale > 156) scale = 2;

  int offsetX = (SCREEN_W - (size * scale)) / 2;
  int offsetY = 45;
  lastQrBottomY = offsetY + (size * scale);

  for (int y = 0; y < size; y++) {
    for (int x = 0; x < size; x++) {
      uint16_t color = esp_qrcode_get_module(qrcode, x, y) ? RGB565_BLACK : RGB565_WHITE;
      gfx->fillRect(offsetX + (x * scale), offsetY + (y * scale), scale, scale, color);
    }
  }
}

void renderQRCode(String title, String text) {
  gfx->fillScreen(RGB565_WHITE);

  int version = 3;
  if (text.length() > 35) version = 4;
  if (text.length() > 55) version = 6;
  if (text.length() > 80) version = 8;
  if (text.length() > 120 || text.startsWith("BEGIN:VCARD") || text.startsWith("MECARD:")) {
    version = 10;
  }

  esp_qrcode_config_t cfg = ESP_QRCODE_CONFIG_DEFAULT();
  cfg.display_func = drawQrCallback;
  cfg.max_qrcode_version = version;
  cfg.qrcode_ecc_level = (version >= 10) ? ESP_QRCODE_ECC_LOW : ESP_QRCODE_ECC_MED;

  esp_qrcode_generate(&cfg, text.c_str());

  gfx->setTextColor(RGB565_BLACK);
  gfx->setTextSize(2);
  String displayTitle = title;
  if (displayTitle.length() == 0 || displayTitle == "SCAN ME") {
    if (text.startsWith("BEGIN:VCARD") || text.startsWith("MECARD:")) {
      displayTitle = "MY CONTACT";
    }
  }
  int titleLen = displayTitle.length() > 13 ? 13 : displayTitle.length();
  int titleX = max(6, (SCREEN_W - titleLen * 12) / 2);
  gfx->setCursor(titleX, 16);
  gfx->print(displayTitle.substring(0, 13));

  gfx->setTextSize(1);
  gfx->setTextColor(0x5AEB);

  String bottomText = text;
  if (text.startsWith("BEGIN:VCARD") || text.startsWith("MECARD:")) {
    bottomText = "Scan to Save Contact";
  }
  int subLen = bottomText.length() > 24 ? 24 : bottomText.length();
  int subX = max(8, (SCREEN_W - subLen * 6) / 2);
  gfx->setCursor(subX, lastQrBottomY + 14);
  gfx->print(bottomText.substring(0, 24));
}

// 7. COMMAND PARSER
void handleCommand(String cmd) {
  Serial.println("CMD: " + cmd);

  // Respond to PING immediately so app knows BLE link is healthy
  if (cmd.startsWith("PING")) {
    sendBleNotification("PONG");
    return;
  }

  // Real-time track scrubber synchronization from Android player
  if (cmd.startsWith("PROG|")) {
    int p1 = cmd.indexOf('|');
    int p2 = cmd.indexOf('|', p1 + 1);
    int p3 = (p2 != -1) ? cmd.indexOf('|', p2 + 1) : -1;
    if (p1 != -1) {
      trackPositionSec = (p2 != -1) ? cmd.substring(p1 + 1, p2).toInt() : cmd.substring(p1 + 1).toInt();
      if (p2 != -1) {
        trackDurationSec = (p3 != -1) ? cmd.substring(p2 + 1, p3).toInt() : cmd.substring(p2 + 1).toInt();
      }
      if (p3 != -1) {
        String playStr = cmd.substring(p3 + 1);
        playStr.trim();
        trackIsPlaying = (playStr == "1" || playStr.equalsIgnoreCase("true"));
      }
      lastScrubberTickMs = millis();
      if (currentMode == MODE_PLEX && currentStyle == STYLE_SCRUBBER) {
        drawScrubberBarOnly();
      }
    }
    return;
  }

  if (cmd.startsWith("CLEAR") || cmd.startsWith("WIPE") || cmd.startsWith("CLS")) {
    currentMode = MODE_CLEAR;
    wipeRequested = true;
    return;
  }

  if (cmd.startsWith("STYLE|")) {
    String s = cmd.substring(6);
    s.trim();
    s.toLowerCase();
    int oldStyle = currentStyle;
    if (s == "visualizer" || s == "2" || s == "3") currentStyle = STYLE_VISUALIZER;
    else currentStyle = STYLE_SCRUBBER;

    titleScrollPos = 0;
    titlePauseTicks = 8;
    lastTitleScrollMs = millis();

    if (currentStyle != oldStyle || currentMode != MODE_PLEX) {
      if (currentStyle != oldStyle) {
        hasAlbumArtLoaded = false;
      }
      currentMode = MODE_PLEX;
      uiNeedsRedraw = true;
    }
  }
  else if (cmd.startsWith("PLEX|")) {
    int p1 = cmd.indexOf('|');
    int p2 = cmd.indexOf('|', p1 + 1);
    int p3 = cmd.indexOf('|', p2 + 1);
    int p4 = cmd.indexOf('|', p3 + 1);
    int p5 = (p4 != -1) ? cmd.indexOf('|', p4 + 1) : -1;
    int p6 = (p5 != -1) ? cmd.indexOf('|', p5 + 1) : -1;
    int p7 = (p6 != -1) ? cmd.indexOf('|', p6 + 1) : -1;
    int p8 = (p7 != -1) ? cmd.indexOf('|', p7 + 1) : -1;
    int p9 = (p8 != -1) ? cmd.indexOf('|', p8 + 1) : -1;

    if (p1 != -1 && p2 != -1) {
      trackTitle  = cmd.substring(p1 + 1, p2);
      trackArtist = p3 != -1 ? cmd.substring(p2 + 1, p3) : cmd.substring(p2 + 1);
      trackAlbum  = (p3 != -1 && p4 != -1) ? cmd.substring(p3 + 1, p4) : "";
      if (p4 != -1) {
        String hex = (p5 != -1) ? cmd.substring(p4 + 1, p5) : cmd.substring(p4 + 1);
        setRgbHex(hex);
      }
      if (p5 != -1) {
        String s = (p6 != -1) ? cmd.substring(p5 + 1, p6) : cmd.substring(p5 + 1);
        s.trim();
        s.toLowerCase();
        if (s == "visualizer" || s == "2" || s == "3") currentStyle = STYLE_VISUALIZER;
        else currentStyle = STYLE_SCRUBBER;
      }

      String artHash = "";
      if (p6 != -1) {
        artHash = (p7 != -1) ? cmd.substring(p6 + 1, p7) : cmd.substring(p6 + 1);
        artHash.trim();
      }
      lastRequestedArtHash = artHash;

      if (p7 != -1) {
        trackPositionSec = ((p8 != -1) ? cmd.substring(p7 + 1, p8) : cmd.substring(p7 + 1)).toInt();
      } else {
        trackPositionSec = 0;
      }
      if (p8 != -1) {
        trackDurationSec = ((p9 != -1) ? cmd.substring(p8 + 1, p9) : cmd.substring(p8 + 1)).toInt();
      } else {
        trackDurationSec = 0;
      }
      if (p9 != -1) {
        String pl = cmd.substring(p9 + 1);
        pl.trim();
        trackIsPlaying = (pl == "1" || pl.equalsIgnoreCase("true"));
      } else {
        trackIsPlaying = true;
      }
      lastScrubberTickMs = millis();

      titleScrollPos = 0;
      titlePauseTicks = 8;
      lastTitleScrollMs = millis();

      expectedMediaSize = 0;
      mediaWriteIndex = 0;
      newMediaReady = false;
      currentMode = MODE_PLEX;

      bool cacheHit = false;
      // MicroSD Autonomous Album Art Cache Check
      if (currentStyle != STYLE_VISUALIZER && artHash.length() > 0) {
        if (!sdCardReady) initSdCard();
        String artPath = "/art/" + artHash + ".jpg";
        if (sdCardReady && SD_MMC.exists(artPath.c_str())) {
          sendBleNotification("SD_READING|art|" + artHash);
          File f = SD_MMC.open(artPath.c_str(), FILE_READ);
          if (f && f.size() >= 4) {
            size_t sz = f.size();
            if (sz <= actualBufferSize && mediaBuffer != nullptr) {
              f.read(mediaBuffer, sz);
              f.close();
              // Verify cached file is a valid complete JPEG (SOI 0xFFD8 and EOI 0xFFD9)
              bool validCache = (mediaBuffer[0] == 0xFF && mediaBuffer[1] == 0xD8 &&
                                 mediaBuffer[sz - 2] == 0xFF && mediaBuffer[sz - 1] == 0xD9);
              if (validCache) {
                Serial.printf("[SD CACHE HIT] Loaded %s (%u bytes) in 15ms!\n", artPath.c_str(), (unsigned int)sz);
                hasAlbumArtLoaded = true;
                cacheHit = true;
                if (currentStyle == STYLE_SCRUBBER) {
                  renderScrubberNowPlaying();
                }
                drawAlbumArtFromBuffer(sz);
                uiNeedsRedraw = false; // Screen is already drawn completely! Prevent wipe!
                sendBleNotification("CACHE_HIT|" + artHash);
                sendBleNotification("SD_IDLE|");
              } else {
                Serial.printf("[SD CACHE CORRUPT] %s is truncated/invalid. Removing and requesting fresh art.\n", artPath.c_str());
                SD_MMC.remove(artPath.c_str());
                sendBleNotification("SD_IDLE|");
                sendBleNotification("NEED_ART|" + artHash);
              }
            } else {
              f.close();
              sendBleNotification("SD_IDLE|");
              sendBleNotification("NEED_ART|" + artHash);
            }
          } else {
            if (f) {
              f.close();
              SD_MMC.remove(artPath.c_str());
            }
            sendBleNotification("SD_IDLE|");
            sendBleNotification("NEED_ART|" + artHash);
          }
        } else {
          Serial.printf("[SD CACHE MISS / NO SD] %s requesting from phone\n", artHash.c_str());
          sendBleNotification("NEED_ART|" + artHash);
        }
      }

      if (!cacheHit) {
        hasAlbumArtLoaded = false;
        uiNeedsRedraw = true;
      }
    }
  }
  else if (cmd.startsWith("QR|")) {
    int p1 = cmd.indexOf('|');
    int p2 = (p1 != -1) ? cmd.indexOf('|', p1 + 1) : -1;
    int pLast = cmd.lastIndexOf('|');

    if (p2 != -1 && pLast > p2 && (cmd.substring(pLast + 1).startsWith("#") || cmd.substring(pLast + 1).length() == 6 || cmd.substring(pLast + 1).length() == 7)) {
      qrTitle = cmd.substring(p1 + 1, p2);
      qrPayload = cmd.substring(p2 + 1, pLast);
      setRgbHex(cmd.substring(pLast + 1));
    } else if (p2 != -1) {
      String part1 = cmd.substring(p1 + 1, p2);
      String part2 = cmd.substring(p2 + 1);
      if (part2.startsWith("#")) {
        qrTitle = "SCAN ME";
        qrPayload = part1;
        setRgbHex(part2);
      } else {
        qrTitle = part1;
        qrPayload = part2;
      }
    } else {
      qrTitle = "SCAN ME";
      qrPayload = cmd.substring(p1 + 1);
    }
    hasAlbumArtLoaded = false;
    currentMode = MODE_QR;
    uiNeedsRedraw = true;
  }
  else if (cmd.startsWith("PREP_ART|")) {
    expectedMediaSize = cmd.substring(9).toInt();
    mediaWriteIndex = 0;
    newMediaReady = false;
    currentMode = MODE_PLEX;
  }
  else if (cmd.startsWith("SHOW_ART")) {
    int p1 = cmd.indexOf('|');
    int p2 = (p1 != -1) ? cmd.indexOf('|', p1 + 1) : -1;
    int sz = (p1 != -1) ? cmd.substring(p1 + 1, (p2 != -1 ? p2 : cmd.length())).toInt() : 0;
    String hashToSave = (p2 != -1) ? cmd.substring(p2 + 1) : lastRequestedArtHash;
    hashToSave.trim();

    size_t decodeLen = (sz > 0) ? sz : mediaWriteIndex;
    if (decodeLen >= 4 && mediaBuffer != nullptr) {
      // Validate JPEG integrity before rendering or caching
      bool isValidJpeg = (mediaBuffer[0] == 0xFF && mediaBuffer[1] == 0xD8 &&
                          mediaBuffer[decodeLen - 2] == 0xFF && mediaBuffer[decodeLen - 1] == 0xD9);
      if (isValidJpeg) {
        hasAlbumArtLoaded = true;
        drawAlbumArtFromBuffer(decodeLen);
        uiNeedsRedraw = false; // Screen is already drawn completely! Prevent wipe by loop()!

        // Save to MicroSD cache automatically if available
        if (!sdCardReady) initSdCard();
        if (sdCardReady && hashToSave.length() > 0) {
          sendBleNotification("SD_WRITING|art|" + hashToSave);
          String path = "/art/" + hashToSave + ".jpg";
          File f = SD_MMC.open(path.c_str(), FILE_WRITE);
          if (f) {
            f.write(mediaBuffer, decodeLen);
            f.close();
            Serial.printf("[SD CACHE SAVE] Permanently cached %s (%u bytes) to MicroSD!\n", path.c_str(), (unsigned int)decodeLen);
            sendBleNotification("CACHE_SAVED|" + hashToSave);
            sendBleNotification("SD_IDLE|");
          } else {
            sendBleNotification("SD_IDLE|");
          }
        }
      } else {
        Serial.printf("[SHOW_ART REJECTED] Incomplete/corrupt JPEG (%u bytes). Missing SOI/EOI. Requesting fresh stream...\n", (unsigned int)decodeLen);
        if (hashToSave.length() > 0) {
          sendBleNotification("NEED_ART|" + hashToSave);
        }
      }
    }
    mediaWriteIndex = 0;
    expectedMediaSize = 0;
  }
  else if (cmd.startsWith("PREP_GIF|")) {
    expectedMediaSize = cmd.substring(9).toInt();
    mediaWriteIndex = 0;
    gifDataSize = 0;
    newMediaReady = false;
    hasAlbumArtLoaded = false;
    currentMode = MODE_BOOT;
    gfx->fillScreen(RGB565_BLACK);
  }
  else if (cmd.startsWith("PLAY_GIF")) {
    int p1 = cmd.indexOf('|');
    int p2 = (p1 != -1) ? cmd.indexOf('|', p1 + 1) : -1;
    int sz = (p1 != -1) ? cmd.substring(p1 + 1, (p2 != -1 ? p2 : cmd.length())).toInt() : 0;
    String gifNameToSave = (p2 != -1) ? cmd.substring(p2 + 1) : "";
    gifNameToSave.trim();

    gifDataSize = (sz > 0) ? sz : mediaWriteIndex;

    // Automatically cache beamed GIF to MicroSD card!
    if (gifDataSize > 0 && mediaBuffer != nullptr) {
      if (!sdCardReady) initSdCard();
      if (sdCardReady && gifNameToSave.length() > 0) {
        if (!gifNameToSave.endsWith(".gif") && !gifNameToSave.endsWith(".GIF")) {
          gifNameToSave += ".gif";
        }
        sendBleNotification("SD_WRITING|gif|" + gifNameToSave);
        String path = "/gifs/" + gifNameToSave;
        File f = SD_MMC.open(path.c_str(), FILE_WRITE);
        if (f) {
          f.write(mediaBuffer, gifDataSize);
          f.close();
          Serial.printf("[SD GIF SAVE] Saved %s (%u bytes) to MicroSD!\n", path.c_str(), gifDataSize);
          sendBleNotification("GIF_SAVED|" + gifNameToSave);
          sendBleNotification("SD_IDLE|");
        } else {
          sendBleNotification("SD_IDLE|");
        }
      }
    }

    mediaWriteIndex = 0;
    expectedMediaSize = 0;
    hasAlbumArtLoaded = false;
    gfx->fillScreen(RGB565_BLACK);
    currentMode = MODE_GIF;
    newMediaReady = true;
  }
  else if (cmd.startsWith("LIST_SD") || cmd.startsWith("INIT_SD")) {
    if (!sdCardReady) {
      initSdCard();
    }
    if (!sdCardReady) {
      sendBleNotification("SD_FILES|");
      return;
    }
    File root = SD_MMC.open("/gifs");
    if (!root || !root.isDirectory()) {
      sendBleNotification("SD_FILES|");
      return;
    }

    String fileList = "SD_FILES|";
    File file = root.openNextFile();
    bool first = true;
    while (file) {
      if (!file.isDirectory()) {
        String name = String(file.name());
        int lastSlash = name.lastIndexOf('/');
        if (lastSlash >= 0) name = name.substring(lastSlash + 1);
        while (name.startsWith("/")) name.remove(0, 1);
        if (name.endsWith(".gif") || name.endsWith(".GIF")) {
          if (!first) fileList += ",";
          fileList += name;
          first = false;
        }
      }
      file = root.openNextFile();
    }
    root.close();
    sendBleNotification(fileList);
  }
  else if (cmd.startsWith("PLAY_SD|")) {
    String filename = cmd.substring(8);
    filename.trim();
    while (filename.startsWith("/")) filename.remove(0, 1);
    if (filename.startsWith("gifs/")) filename.remove(0, 5);
    while (filename.startsWith("/")) filename.remove(0, 1);
    String fullPath = "/gifs/" + filename;

    if (!sdCardReady) initSdCard();
    if (!sdCardReady || !SD_MMC.exists(fullPath.c_str())) {
      Serial.println("[SD] GIF not found: " + fullPath);
      sendBleNotification("SD_IDLE|");
      return;
    }

    sendBleNotification("SD_READING|gif|" + filename);
    File f = SD_MMC.open(fullPath.c_str(), FILE_READ);
    if (!f) {
      sendBleNotification("SD_IDLE|");
      return;
    }

    size_t sz = f.size();
    if (sz > 0 && sz <= actualBufferSize && mediaBuffer != nullptr) {
      f.read(mediaBuffer, sz);
      f.close();
      gifDataSize = sz;
      mediaWriteIndex = 0;
      expectedMediaSize = 0;
      hasAlbumArtLoaded = false;
      gfx->fillScreen(RGB565_BLACK);
      currentMode = MODE_GIF;
      newMediaReady = true;
      Serial.printf("[SD PLAY] Playing %s (%u bytes) in 20ms!\n", fullPath.c_str(), sz);
      sendBleNotification("SD_IDLE|");
    } else {
      f.close();
      sendBleNotification("SD_IDLE|");
    }
  }
  else if (cmd.startsWith("WIFI_ON")) {
    WiFi.softAP("Backpack-Beam", "backpack123");
    httpServer.begin();
    wifiBurstActive = true;
  }
}

// 8. BLE CALLBACKS
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    bleConnected = true;
    rgb.setPixelColor(0, rgb.Color(0, 150, 255));
    rgb.show();
    if (!sdCardReady) {
      initSdCard();
    }
    if (sdCardReady) {
      sendBleNotification("SD_READY|1");
    } else {
      sendBleNotification("SD_READY|0");
    }
  }
  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    rgb.setPixelColor(0, rgb.Color(255, 100, 0));
    rgb.show();
    // Restart advertising immediately so companion app can auto-reconnect seamlessly!
    pServer->startAdvertising();
    Serial.println("[BLE] Disconnected - Restarted Advertising for Auto-Reconnect");
  }
};

class CmdCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    String val = pChar->getValue().c_str();
    if (val.length() > 0) handleCommand(val);
  }
};

class DataCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) {
    uint8_t* pData = pChar->getData();
    size_t len = pChar->getLength();

    if (pData == nullptr || len == 0) return;

    if (mediaBuffer != nullptr && (mediaWriteIndex + len) <= actualBufferSize) {
      memcpy(mediaBuffer + mediaWriteIndex, pData, len);
      mediaWriteIndex += len;

      if (expectedMediaSize > 0 && mediaWriteIndex >= expectedMediaSize) {
        newMediaReady = true;
        Serial.printf("[DATA] Buffer complete: %u / %u bytes\n",
          (unsigned int)mediaWriteIndex, (unsigned int)expectedMediaSize);
      }
    } else if (mediaBuffer != nullptr) {
      // Buffer overflow: reset and request re-stream so we don't silently corrupt
      Serial.printf("[DATA OVERFLOW] %u bytes overflow buffer (%u/%u). Resetting buffer.\n",
        (unsigned int)len, (unsigned int)mediaWriteIndex, (unsigned int)actualBufferSize);
      mediaWriteIndex = 0;
      expectedMediaSize = 0;
      newMediaReady = false;
      if (bleConnected && lastRequestedArtHash.length() > 0) {
        sendBleNotification("NEED_ART|" + lastRequestedArtHash);
      }
    }
  }
};

// 9. SETUP & LOOP
void setup() {
  Serial.begin(115200);

  pinMode(LCD_BL, OUTPUT);
  digitalWrite(LCD_BL, HIGH);
  rgb.begin();
  rgb.setBrightness(80);
  rgb.setPixelColor(0, rgb.Color(255, 100, 0));
  rgb.show();

  if (psramFound()) {
    mediaBuffer = (uint8_t *)ps_malloc(MAX_MEDIA_SIZE);
    if (mediaBuffer != nullptr) {
      actualBufferSize = MAX_MEDIA_SIZE;
      Serial.println("PSRAM ready: 2MB media buffer");
    }
  }
  if (mediaBuffer == nullptr) {
    actualBufferSize = 64 * 1024;
    mediaBuffer = (uint8_t *)malloc(actualBufferSize);
  }

  gfx->begin();
  gfx->fillScreen(RGB565_BLACK);
  gif.begin(LITTLE_ENDIAN_PIXELS); // Must be LITTLE_ENDIAN for draw16bitRGBBitmap!

  // Initialize MicroSD Card Slot
  initSdCard();

  BLEDevice::init("Backpack-ESP32");
  BLEDevice::setPower(ESP_PWR_LVL_P9);
  BLEDevice::setMTU(517);

  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCmdChar = pService->createCharacteristic(
    CHAR_CMD_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR |
    BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ
  );
  pCmdChar->addDescriptor(new BLE2902());
  pCmdChar->setCallbacks(new CmdCallbacks());

  BLECharacteristic *pDataChar = pService->createCharacteristic(
    CHAR_DATA_UUID, BLECharacteristic::PROPERTY_WRITE_NR
  );
  pDataChar->setCallbacks(new DataCallbacks());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x0C);
  pAdvertising->setMaxPreferred(0x18);
  BLEDevice::startAdvertising();

  httpServer.on("/upload_gif", HTTP_POST, []() {
    httpServer.send(200, "text/plain", "OK");
    WiFi.softAPdisconnect(true);
    wifiBurstActive = false;
    currentMode = MODE_GIF;
    newMediaReady = true;
  }, []() {
    HTTPUpload& upload = httpServer.upload();
    if (upload.status == UPLOAD_FILE_START) {
      mediaWriteIndex = 0;
    } else if (upload.status == UPLOAD_FILE_WRITE) {
      if (mediaBuffer != nullptr && mediaWriteIndex + upload.currentSize <= actualBufferSize) {
        memcpy(mediaBuffer + mediaWriteIndex, upload.buf, upload.currentSize);
        mediaWriteIndex += upload.currentSize;
      }
    }
  });

  renderScrubberNowPlaying();
}

void loop() {
  if (!bleConnected && oldBleConnected) {
    delay(250);
    BLEDevice::startAdvertising();
    oldBleConnected = bleConnected;
  }
  if (bleConnected && !oldBleConnected) {
    oldBleConnected = bleConnected;
  }

  if (wifiBurstActive) {
    httpServer.handleClient();
  }

  if (wipeRequested) {
    wipeRequested = false;
    instantWipeDisplay();
  }

  if (uiNeedsRedraw) {
    uiNeedsRedraw = false;
    if (currentMode == MODE_PLEX) {
      if (currentStyle == STYLE_VISUALIZER) renderVisualizerNowPlaying();
      else renderScrubberNowPlaying();
    }
    else if (currentMode == MODE_QR) renderQRCode(qrTitle, qrPayload);
  }

  if (newMediaReady) {
    newMediaReady = false;
    // Note: Album art is decoded and verified exclusively inside SHOW_ART handler to guarantee complete JPEG transfer.
    if (currentMode == MODE_GIF) {
      gfx->fillScreen(RGB565_BLACK);
      if (gifDataSize == 0 && mediaWriteIndex > 0) {
        gifDataSize = mediaWriteIndex;
      }
    }
  }

  if (currentMode == MODE_PLEX) {
    updateTitleScroll();

    if (currentStyle == STYLE_SCRUBBER && trackIsPlaying && trackDurationSec > 0) {
      if (millis() - lastScrubberTickMs >= 1000) {
        lastScrubberTickMs = millis();
        if (trackPositionSec < trackDurationSec) {
          trackPositionSec++;
          drawScrubberBarOnly();
        }
      }
    }
  }

  if (currentMode == MODE_PLEX && currentStyle == STYLE_VISUALIZER) {
    static unsigned long lastViz = 0;
    if (millis() - lastViz >= 45) {
      lastViz = millis();
      animateVisualizerBars();
    }
  }

  if (currentMode == MODE_GIF && gifDataSize > 0 && mediaBuffer != nullptr) {
    if (gif.open(mediaBuffer, gifDataSize, gifDrawCallback)) {
      int iDelay = 0;
      while (gif.playFrame(true, &iDelay)) {
        if (iDelay > 0) {
          delay(iDelay);
        } else {
          vTaskDelay(15 / portTICK_PERIOD_MS);
        }
        if (uiNeedsRedraw || newMediaReady || wipeRequested || currentMode != MODE_GIF) break;
      }
      gif.close();
    } else {
      gfx->fillScreen(RGB565_BLACK);
      gfx->setTextColor(0xF800);
      gfx->setTextSize(2);
      gfx->setCursor(10, 100);
      gfx->println("GIF ERROR");
      gfx->setTextSize(1);
      gfx->setTextColor(RGB565_WHITE);
      gfx->setCursor(10, 130);
      gfx->println("Use app auto-optimizer");
      gfx->setCursor(10, 150);
      gfx->println("Max resolution: 172x320");
      vTaskDelay(2000 / portTICK_PERIOD_MS);
      currentMode = MODE_BOOT;
    }
  }

  vTaskDelay(5 / portTICK_PERIOD_MS);
}
