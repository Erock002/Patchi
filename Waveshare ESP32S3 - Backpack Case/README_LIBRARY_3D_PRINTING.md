# Patchi / Waveshare ESP32-S3 3D Printing Guide for Libraries & Makerspaces

## 1. Device Fit Clarification
> **Does this enclosure surround the case and device, or just the device?**  
> **It surrounds JUST the bare device.**  
> The internal cavity is precision-modeled to **37.0 mm × 20.5 mm × 8.3 mm**, which directly matches the bare **Waveshare ESP32-S3 GEEK** board. You do **not** need another case on the board. The bare board drops directly into the enclosure. If the board were inside another case, it would be too large to fit.

---

## 2. Single-Print Files (Merged for 1-File Library Submission)

Most public libraries only allow **one STL file per booking or daily submission**.  
To solve this, both halves have been rotated flat onto the print bed ($Z=0$), spaced cleanly apart, and exported as **single merged STL files**:

| File Name | Purpose | Dimensions on Bed | Description |
| :--- | :--- | :--- | :--- |
| [`Patchi_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl`](./Patchi_Backpack_Mount_2Piece_SINGLE_PRINT_PLATE.stl) | **Recommended for Backpack** | 52.0 × 81.0 × 9.7 mm | Front Bezel + Rear Housing side-by-side. Clamps through backpack fabric with M2 screws + USB dongle channel. |
| [`Waveshare_Closed_Case_SINGLE_PRINT_PLATE.stl`](./Waveshare_Closed_Case_SINGLE_PRINT_PLATE.stl) | **Pocket / Standalone Case** | 41.0 × 59.0 × 8.5 mm | Top Bezel + Bottom Shell side-by-side. Snap-fit enclosure for holding the device in your pocket or desk. |
| [`Patchi_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl`](./Patchi_Backpack_Mount_FullSuite_SINGLE_PRINT_PLATE.stl) | **Full Mount + Fabric Ring** | 52.0 × 126.5 × 9.7 mm | Front Bezel + Rear Housing + Inner Reinforcement Clamp Ring all in one print. |

---

## 3. Recommended Library Print Settings
Give these settings to the library staff or input them into their slicer (Bambu Studio, PrusaSlicer, Cura):

- **Material**: PLA (standard) or PETG (extra outdoor durability)
- **Color**: Black or Dark Gray
- **Layer Height**: `0.20 mm` (Standard) or `0.16 mm` (Fine detail)
- **Infill**: `20%` to `30%` (Gyroid or Grid)
- **Walls / Perimeters**: `3 walls` (provides strong threads for M2 screws)
- **Supports**: **None needed** (both parts are pre-oriented flat on their largest planar surfaces)
- **Brim / Raft**: None needed (parts have large, flat contact surfaces)
- **Estimated Print Time**: ~25 to 45 minutes on modern printers (Bambu Lab, Prusa MK4, Ender 3 V3)

---

## 4. Mechanical Design Features (Updated v2)

1. **Vertical Button Slide-in Grooves**:
   - The ESP32-S3 GEEK side tactile push buttons protrude ~1.2 mm beyond the PCB edge.
   - The rear housing features 1.2 mm deep vertical guide channels running from the top rim down to the button windows, allowing the board to slide straight in without binding or bending the buttons.
2. **Telescoping Snap-Fit Lip & Retention Beads**:
   - The rear housing has a stepped male lip (38.8 × 22.3 mm) with 0.35 mm triangular retention snap beads.
   - The front bezel has a matching female socket (39.2 × 22.7 mm) with 0.20 mm FDM clearance.
   - When pressed together, the halves snap firmly shut with a tactile click, forming a flush 41.0 × 24.5 mm outer seam while maintaining perfect 4x M2 screw alignment.
3. **USB Connector Clearance (Bar Removed)**:
   - The solid bar across the USB connector end in the Front Bezel collar and female socket has been eliminated.
   - A full 16.5 mm wide open clearance channel passes over the USB-A connector and out through the end wall, giving the USB connector 4.9 mm of breathing room so the Front Bezel seats 100% flush without pressing, flexing, or bending the screen or USB pins.
4. **100% Solid Closed Back Protective Shell**:
   - The rear floor cable-drop window has been closed up with a solid 1.2 mm base plate, fully protecting the back of the PCB and components from dust, lint, and weather.
