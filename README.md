# Patchi — Wearable Smart Display for Backpacks

<div align="center">

![Patchi Banner](https://img.shields.io/badge/Patchi-Wearable%20Display-00E5FF?style=for-the-badge&logo=bluetooth&logoColor=black)
[![Build Patchi APK](https://github.com/Erock002/Patchi/actions/workflows/build-apk.yml/badge.svg)](https://github.com/Erock002/Patchi/actions/workflows/build-apk.yml)
![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)
![ESP32-S3](https://img.shields.io/badge/Hardware-ESP32--S3-red?style=for-the-badge&logo=espressif)
![Android 14+](https://img.shields.io/badge/Android-14%20%7C%2015%20%7C%2016-green?style=for-the-badge&logo=android)
![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react)

**Transform any backpack into a dynamic, cyberpunk smart wearable.**  
Live Spotify & media Now Playing with album art, instant digital contact cards (vCard / QR), and animated pixel-art GIFs — bolted into canvas without glue, velcro, or sewing.

[Download Patchi APK](https://github.com/Erock002/Patchi/releases/latest) • [3D Print Files](#-3d-printing--assembly) • [Firmware Guide](#-esp32-firmware-flashing) • [Android App](#-android-companion-app)

</div>

---

## ⚡ Highlights

* 🎵 **Live Now Playing Display**: Streams album art, artist, track name, and a live progress scrubber directly from your phone (Spotify, Apple Music, YouTube Music, Plexamp, Symfonium).
* 📇 **Dynamic Contact Card & QR Codes**: Swap to your Instagram profile, personal vCard, Wi-Fi credentials, or custom URL with one tap. People can scan directly off your backpack.
* 👾 **Retro GIF Player**: Loops animated pixel art, dithered graphics, and animations.
* 🔩 **Zero-Destruction 2-Piece Sandwich Clamp**: Clamps tightly through fabric using 4x countersunk M2 screws. No glue, no sewing, fully removable.
* 🎛️ **Engineered for ESP32 Hardware**: Built-in vertical button slide-in guide channels prevent side switches from snapping during installation; telescoping male/female snap beads seal the enclosure flush.
* 🔋 **All-Day Low Power**: Runs continuously off any pocket power bank via an internal low-profile USB channel.
* 📱 **Native Android Background Sync**: High-efficiency Android foreground service keeps BLE streaming active 24/7 without being killed when your phone is locked in your pocket.

---

## 🛠️ System Architecture

```mermaid
flowchart LR
    subgraph Phone["Android Phone (Pixel / Samsung)"]
        MEDIA["Music Apps\n(Spotify / Apple / Plex)"] -->|MediaSession| LISTENER["MediaNotificationListener\n(Java Service)"]
        LISTENER -->|Center-Crop 172x172\nPalette Extraction| NATIVE_BLE["Native BLE Manager\n(Direct BluetoothGatt)"]
        APP["Patchi Companion App\n(Capacitor + React 19)"] -.->|Presets & GIFs| NATIVE_BLE
    end

    subgraph Hardware["Backpack Enclosure (Patchi Mount)"]
        NATIVE_BLE -->|BLE 5.0 (512 MTU)| ESP["Waveshare ESP32-S3\n(Dual Core 240MHz)"]
        ESP -->|SPI (40MHz)| SCREEN["ST7789 IPS LCD\n(16-Bit RGB565)"]
        ESP <-->|4-bit SD_MMC Parallel| SD["MicroSD Card\n(Offline Art Cache)"]
    end
```

---

## 📦 Hardware Bill of Materials (BOM)

| Item | Component | Notes |
| :--- | :--- | :--- |
| **Microcontroller & LCD** | [Waveshare ESP32-S3-LCD-1.47](https://www.waveshare.com/esp32-s3-lcd-1.47.htm) or **ESP32-S3 GEEK** | 240×135 or 172×320 IPS display, onboard MicroSD slot, RGB LED |
| **Enclosure** | 3D-Printed Patchi 2-Piece Sandwich Mount | Printable in PLA or PETG (files in [`Waveshare ESP32S3 - Backpack Case/`](./Waveshare%20ESP32S3%20-%20Backpack%20Case/)) |
| **Fasteners** | 4× **M2 Countersunk Screws** (8mm to 12mm) + M2 nuts (optional) | Stainless steel or black oxide; threads directly into 3D print |
| **Power** | Slim 5V USB Power Bank + Flat 90° USB-C or USB-A Cable | Stays inside the backpack front pocket |
| **Backpack** | Any canvas, nylon, or cordura bag (JanSport, Herschel, etc.) | Flange clamps fabric securely without fraying |

---

## 🖨️ 3D Printing & Assembly

The enclosure is engineered specifically to protect the bare ESP32-S3 board and ensure buttons don't snag or bind during insertion.

<div align="center">

| Model File | Description | Bed Dimensions |
| :--- | :--- | :--- |
| [`Patchi_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl`](./Waveshare%20ESP32S3%20-%20Backpack%20Case/Patchi_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl) | **Recommended**: Front Bezel + Rear Housing side-by-side | 52.0 × 81.0 × 9.7 mm |
| [`Patchi_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl`](./Waveshare%20ESP32S3%20-%20Backpack%20Case/Patchi_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl) | Front Bezel + Rear Housing + Inner Reinforcement Clamp Ring | 52.0 × 126.5 × 9.7 mm |
| [`Patchi_Fabric_Cutout_Stencil.stl`](./Waveshare%20ESP32S3%20-%20Backpack%20Case/Patchi_Fabric_Cutout_Stencil.stl) | Fabric cutting template for clean installation | 52.0 × 35.5 × 1.2 mm |

</div>

### Slicer Settings (Public Library & Home Printers)
* **Material**: PLA (indoor/standard) or PETG (high-temp/outdoor)
* **Layer Height**: `0.20 mm` (Standard) or `0.16 mm` (Fine)
* **Walls / Perimeters**: `3 walls` (ensures strong threads for M2 screws)
* **Infill**: `20%` – `30%` (Gyroid or Grid)
* **Supports**: **None needed** (all models are pre-oriented flat on $Z=0$)
* **Print Time**: ~25 to 40 minutes on modern printers (Bambu Lab, Prusa MK4, Ender 3 V3)

### Mechanical Design Features
1. **Vertical Button Slide-in Grooves**: The ESP32 side buttons protrude ~1.2mm. Precision vertical tracks down the inner sidewalls allow the board to drop straight in without shearing the switches.
2. **Telescoping Snap-Fit Lip**: Stepped male lip on the rear housing clicks into the front bezel with retention beads for a tactile snap before screws are tightened.
3. **USB Connector Clearance Channel**: Full 16.5mm open channel prevents pressing on the USB connector or bending the screen.
4. **100% Closed Back**: The rear shell protects the PCB components and solder points against dust, lint, and moisture.

---

## 📱 Android Companion App

The **Patchi** Android app runs on Android 10 through 16 (including Samsung One UI and Google Pixel).

### Installing the Pre-Built APK
1. Download **`Patchi.apk`** from [Latest GitHub Releases](https://github.com/Erock002/Patchi/releases/latest).
2. Install the APK on your Android device.

### Setting Up Pixel / Restricted Settings (Android 13, 14, 15, 16)
On Google Pixel devices, Android requires explicit authorization for sideloaded notification listeners:
1. Go to **Settings → Apps → Patchi**.
2. Tap the **3 dots (⋮)** in the top right corner and tap **"Allow restricted settings"** (authenticate with fingerprint/PIN).
3. Go to **Settings → Apps → Special app access → Notification access**, tap **Patchi**, and toggle it **ON**.

> [!TIP]
> **Optional 1-Click ADB Command**:
> ```bash
> adb shell cmd notification allow_listener com.patchi.app/com.patchi.app.MediaNotificationListener
> ```

---

## 💻 ESP32 Firmware Flashing

The firmware is located in [`firmware/WaveShare_ESP32S3_Companion/WaveShare_ESP32S3_Companion.ino`](./firmware/WaveShare_ESP32S3_Companion/WaveShare_ESP32S3_Companion.ino).

### Arduino IDE Configuration
1. Install **ESP32 Core by Espressif** (v3.x or v2.x supported) via Boards Manager.
2. Under **Tools**, configure:
   * **Board**: `ESP32S3 Dev Module` (or `Waveshare ESP32-S3-LCD-1.47` / `GEEK`)
   * **USB CDC On Boot**: `Enabled`
   * **PSRAM**: `OPI PSRAM` (or `QSPI PSRAM` depending on revision)
   * **Flash Size**: `16MB (128Mb)`
   * **Partition Scheme**: `16M Flash (3MB APP/9.9MB FATFS)` or `Huge APP (3MB No OTA/1MB SPIFFS)`
3. Install required libraries from Library Manager:
   * `Arduino_GFX_Library` (by Moon On Our Nation)
   * `JPEGDEC` (by Larry Bank)
   * `AnimatedGIF` (by Larry Bank)
   * `Adafruit NeoPixel`
   * `qrcode` (by Richard Moore)
4. Connect the ESP32-S3 via USB-C, select the COM port, and click **Upload**.

---

## 🌐 Web Simulator & Local Development

Patchi includes a full real-time browser simulator for testing layouts, color palettes, and BLE protocols without hardware.

```bash
# Clone the repository
git clone https://github.com/Erock002/Patchi.git
cd Patchi

# Install dependencies with Bun or NPM
bun install

# Start development server
bun run dev
```

Visit `http://localhost:3000` to interact with the virtual display simulator, test album art conversion, and preview retro GIFs.

To sync web assets into the Android native project:
```bash
bun run build
bunx cap sync android
```

---

## 📡 Bluetooth LE Protocol Spec

* **Service UUID**: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
* **Command Characteristic (Write/Notify)**: `beb5483e-36e1-4688-b7f5-ea07361b26a8`
* **Data Characteristic (Write Without Response)**: `826f6405-10a0-422c-94f7-558b99e08374`

| Command | Format | Action |
| :--- | :--- | :--- |
| `SHOW_ART` | `SHOW_ART\|<size>\|<hash>` | Prepares buffer for raw JPEG stream |
| `META` | `META\|<title>\|<artist>\|<album>` | Updates scrolling track text |
| `PROG` | `PROG\|<posSec>\|<durSec>\|<isPlaying>` | Updates real-time scrubber bar |
| `STYLE` | `STYLE\|<1-3>` | 1=Fullscreen Art, 2=Scrubber, 3=Visualizer |
| `QR` | `QR\|<title>\|<url>` | Generates on-device QR code |
| `PLAY_GIF` | `PLAY_GIF\|<size>` | Streams and plays animated GIF in loop |
| `PING` | `PING` | Responds with `PONG` for link heartbeat |
| `CLEAR` | `CLEAR` | Clears display to sleep mode |

---

## 🤝 Contributing

Contributions, feature suggestions, and mount adaptations (bike mounts, messenger bags, desk stands) are welcome!
1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'feat: add AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

<div align="center">
Built with ❤️ for makers, music lovers, and cyberpunk wearable enthusiasts.
</div>