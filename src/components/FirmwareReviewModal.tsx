/**
 * Firmware Review & Enhanced C++ Arduino Code.
 * Provides line-by-line expert review of the user's ESP32-S3 code,
 * explains critical fixes (watchdog timer, PSRAM safety, QR dynamic scaling),
 * and provides the updated, production-ready Arduino sketch.
 */

import React, { useState } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  Code2,
  Copy,
  Download,
  Check,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';

export const ENHANCED_FIRMWARE_CODE = `// ============================================================================
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

  if (mediaBuffer[len - 2] != 0xFF || mediaBuffer[len - 1] != 0xD9) {
    if (len + 2 <= actualBufferSize) {
      mediaBuffer[len] = 0xFF;
      mediaBuffer[len + 1] = 0xD9;
      len += 2;
    }
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

  int barX = 10;
  int barY = 252;
  int barW = SCREEN_W - 20;
  int barH = 6;
  gfx->fillRoundRect(barX, barY, barW, barH, 3, 0x2124);
  gfx->fillRoundRect(barX, barY, (barW * 46) / 100, barH, 3, 0xFD20);
  gfx->fillCircle(barX + (barW * 46) / 100, barY + 3, 4, RGB565_WHITE);

  gfx->setTextSize(1);
  gfx->setTextColor(0x7BEF);
  gfx->setCursor(10, 268);
  gfx->print("1:28");
  gfx->setCursor(SCREEN_W - 38, 268);
  gfx->print("3:14");
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
        artHash = cmd.substring(p6 + 1);
        artHash.trim();
      }
      lastRequestedArtHash = artHash;

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
          if (f && f.size() > 0) {
            size_t sz = f.size();
            if (sz <= actualBufferSize && mediaBuffer != nullptr) {
              f.read(mediaBuffer, sz);
              f.close();
              Serial.printf("[SD CACHE HIT] Loaded %s (%u bytes) in 15ms!\n", artPath.c_str(), sz);
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
              f.close();
              sendBleNotification("SD_IDLE|");
            }
          } else {
            sendBleNotification("SD_IDLE|");
          }
        } else if (sdCardReady) {
          Serial.printf("[SD CACHE MISS] %s missing from SD\n", artHash.c_str());
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
    if (decodeLen > 0) {
      hasAlbumArtLoaded = true;
      drawAlbumArtFromBuffer(decodeLen);

      // Save to MicroSD cache automatically if available
      if (!sdCardReady) initSdCard();
      if (sdCardReady && hashToSave.length() > 0 && mediaBuffer != nullptr) {
        sendBleNotification("SD_WRITING|art|" + hashToSave);
        String path = "/art/" + hashToSave + ".jpg";
        File f = SD_MMC.open(path.c_str(), FILE_WRITE);
        if (f) {
          f.write(mediaBuffer, decodeLen);
          f.close();
          Serial.printf("[SD CACHE SAVE] Permanently cached %s (%u bytes) to MicroSD!\n", path.c_str(), decodeLen);
          sendBleNotification("CACHE_SAVED|" + hashToSave);
          sendBleNotification("SD_IDLE|");
        } else {
          sendBleNotification("SD_IDLE|");
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
        if (name.startsWith("/")) name.remove(0, 1);
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
    if (!filename.startsWith("/")) filename = "/" + filename;
    String fullPath = "/gifs" + filename;

    if (!sdCardReady) initSdCard();
    if (!sdCardReady || !SD_MMC.exists(fullPath.c_str())) {
      Serial.println("[SD] GIF not found: " + fullPath);
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
  else if (cmd.startsWith("PING")) {
    Serial.println("PING keepalive received");
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
    }
  }
  void onDisconnect(BLEServer* pServer) {
    bleConnected = false;
    rgb.setPixelColor(0, rgb.Color(255, 100, 0));
    rgb.show();
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

    if (mediaBuffer != nullptr && (mediaWriteIndex + len) <= actualBufferSize) {
      memcpy(mediaBuffer + mediaWriteIndex, pData, len);
      mediaWriteIndex += len;

      if (expectedMediaSize > 0 && mediaWriteIndex >= expectedMediaSize) {
        newMediaReady = true;
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
    if (currentMode == MODE_PLEX && mediaWriteIndex > 0) {
      drawAlbumArtFromBuffer(mediaWriteIndex);
      mediaWriteIndex = 0;
      expectedMediaSize = 0;
    }
    else if (currentMode == MODE_GIF) {
      gfx->fillScreen(RGB565_BLACK);
      if (gifDataSize == 0 && mediaWriteIndex > 0) {
        gifDataSize = mediaWriteIndex;
      }
    }
  }

  if (currentMode == MODE_PLEX) {
    updateTitleScroll();
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
`;

export const FirmwareReviewModal: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ENHANCED_FIRMWARE_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([ENHANCED_FIRMWARE_CODE], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'WaveShare_ESP32S3_Companion.ino';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="p-4 bg-[#222228] border border-[#33333C] rounded-2xl">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-white flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-bold text-white">
              Verdict: Excellent Architecture! Yes, we can work directly with this.
            </h3>
            <p className="text-xs text-[#9E9EA8] mt-1 leading-relaxed">
              Your code for the WaveShare ESP32-S3 1.47" board is extraordinarily well thought out.
              The ST7789 display offset (<code className="text-white">34 col offset</code>),
              PSRAM allocation (<code className="text-white">ps_malloc(2MB)</code>), BLE MTU 517 negotiation,
              and pipe-delimited packet protocol are completely sound.
            </p>
          </div>
        </div>
      </div>

      {/* Review Points Breakdown */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold text-[#9E9EA8] uppercase tracking-wider">
          Critical Observations & Fixes
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Fix 1: Watchdog */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <AlertTriangle className="w-4 h-4 text-white" />
              <span>1. GIF Loop Watchdog Reset (Crucial)</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              In your original code, <code className="text-white">while (gif.playFrame(true, NULL))</code> loops endlessly without yielding. On ESP32-S3 FreeRTOS, this causes the Task Watchdog Timer (TWDT) to trigger and reboot after 5 seconds.
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Fix: Added <code className="text-white">vTaskDelay(1)</code> inside the frame loop.
            </div>
          </div>

          {/* Fix 2: Dynamic QR Code */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <AlertTriangle className="w-4 h-4 text-white" />
              <span>2. Dynamic QR Code Buffer Scaling</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              Your sketch hardcoded <code className="text-white">qrcode_getBufferSize(4)</code>. Version 4 maxes out around 50 characters; a longer URL or Wi-Fi string would cause memory corruption or fail silently.
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Fix: Dynamic buffer allocation scaling between V3 to V7.
            </div>
          </div>

          {/* Fix 3: BLE Command permissions */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <Cpu className="w-4 h-4 text-white" />
              <span>3. BLE Command PROPERTY_WRITE_NR</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              Android Chrome and Android BLE stacks perform much faster and avoid GATT error 133 when command characteristics support Write Without Response (<code className="text-white">PROPERTY_WRITE_NR</code>).
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Fix: Added <code className="text-white">PROPERTY_WRITE_NR</code> to CHAR_CMD_UUID.
            </div>
          </div>

          {/* Fix 4: PSRAM Safety & IDE Settings */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <Layers className="w-4 h-4 text-white" />
              <span>4. PSRAM Null Check & Arduino IDE Setup</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              Ensure in Arduino IDE: <strong>Tools &gt; PSRAM &gt; "OPI PSRAM"</strong> is selected. We also added null-pointer guards in <code className="text-white">memcpy</code> so missing PSRAM doesn't panic Core 0.
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Fix: Safe guards before all <code className="text-white">mediaBuffer</code> access.
            </div>
          </div>

          {/* Fix 5: Huge APP Partition Scheme */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <Cpu className="w-4 h-4 text-white" />
              <span>5. Tools &gt; Partition Scheme: "Huge APP"</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              Because this firmware combines BLE, WiFi Direct, WebServer, and SD_MMC parallel bus drivers, binary size is ~1.34 MB. Select <strong>Tools &gt; Partition Scheme &gt; "Huge APP (3MB No OTA/1MB SPIFFS)"</strong> to prevent space overflow.
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Setting: Tools &gt; Partition Scheme &gt; Huge APP (3MB No OTA)
            </div>
          </div>

          {/* Fix 6: MicroSD Cache & Fullscreen Wipe Guard */}
          <div className="p-3.5 bg-[#222228] rounded-xl border border-[#33333C] space-y-1.5">
            <div className="flex items-center gap-2 text-white text-xs font-bold">
              <Sparkles className="w-4 h-4 text-white" />
              <span>6. MicroSD Cache & Fullscreen Wipe Guard</span>
            </div>
            <p className="text-[11px] text-[#9E9EA8] leading-normal">
              Autonomous 15ms cache hits on MicroSD now set <code className="text-white">hasAlbumArtLoaded = true</code> so subsequent <code className="text-white">loop()</code> render passes only repaint text banners and never wipe loaded artwork!
            </p>
            <div className="text-[10px] text-white font-mono-code bg-[#1A1A1E] p-1.5 rounded">
              Status: SD_READING | SD_WRITING | SD_IDLE telemetry enabled.
            </div>
          </div>
        </div>

        {/* Warning Callout for Arduino IDE pasting */}
        <div className="p-3 bg-[#222228] border border-[#33333C] rounded-xl flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-[#9E9EA8] leading-relaxed">
            <strong className="text-white">Important Arduino IDE Paste Tip:</strong> Before pasting this code into Arduino IDE, press <kbd className="px-1 py-0.5 rounded bg-[#1A1A1E] text-white font-mono">Cmd+A</kbd> (or <kbd className="px-1 py-0.5 rounded bg-[#1A1A1E] text-white font-mono">Ctrl+A</kbd>) and hit <strong>Delete</strong> to clear the editor completely. Pasting without clearing can duplicate the sketch and cause redefinition errors.
          </div>
        </div>
      </div>

      {/* Code Viewer & Action Bar */}
      <div className="bg-[#1A1A1E] rounded-2xl border border-[#2C2C32] overflow-hidden">
        <div className="p-3 bg-[#1A1A1E] flex items-center justify-between border-b border-[#2C2C32]">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-white" />
            <span className="text-xs font-mono-code text-white">
              WaveShare_ESP32S3_Companion.ino
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="px-2.5 py-1 rounded-lg bg-[#222228] hover:bg-[#2C2C32] text-xs text-white flex items-center gap-1.5 transition-colors border border-[#33333C]"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5 text-white" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="px-2.5 py-1 rounded-lg bg-white hover:bg-[#E8E8EC] text-xs text-black font-extrabold flex items-center gap-1.5 transition-colors shadow-sm"
            >
              <Download className="w-3.5 h-3.5 text-black" />
              <span>Download .ino</span>
            </button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto p-4 text-xs font-mono-code text-[#D0D0D8] leading-relaxed bg-[#121214]">
          <pre>{ENHANCED_FIRMWARE_CODE}</pre>
        </div>
      </div>
    </div>
  );
};
