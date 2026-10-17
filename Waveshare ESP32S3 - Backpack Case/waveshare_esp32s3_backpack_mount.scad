// ==============================================================================
// PATCHI - Waveshare ESP32-S3 (GEEK) Backpack Mount & Clamp System (v2.0)
// Fully Parametric OpenSCAD Model with:
//  1. Telescoping Snap-Fit Male/Female Collar with Retention Beads
//  2. Vertical Button Slide-in Guide Grooves (buttons slide smoothly into place)
//  3. Flush 41.0 x 24.5 mm Outer Mating Seam
//  4. Backpack Fabric Clamping Flange with 4x M2 Countersunk Screws
//  5. USB-A Dongle Chamber & Rear Floor Cable Drop Slot
//  6. Single-Print Bed Plate layout for 1-file library 3D printing
// ==============================================================================

/* [Display & Board Cavity Dimensions] */
board_length    = 37.0;  // Length of bare PCB cavity (mm)
board_width     = 20.5;  // Width of bare PCB cavity (mm)
board_depth     = 6.0;   // Depth of internal board pocket in rear housing (mm)
corner_radius   = 1.5;   // Corner fillet radius (mm)

/* [Enclosure Walls & Flanges] */
wall_thickness  = 2.0;   // Base perimeter wall thickness (mm) -> Outer 41.0 x 24.5 mm
floor_thickness = 1.2;   // Rear housing floor thickness (mm)
screen_lip      = 0.6;   // Front screen retaining bezel lip thickness (mm)
collar_height   = 4.0;   // Front bezel total collar height (mm)

/* [Screen Aperture] */
screen_length   = 32.0;  // Visible LCD opening length (mm)
screen_width    = 18.5;  // Visible LCD opening width (mm)

/* [Telescoping Snap-Fit Interface] */
male_lip_h      = 2.5;   // Height of male snap lip extending above rear housing shoulder (mm)
male_length     = 38.8;  // Outer length of male lip (mm) -> 1.1 mm shoulder all around
male_width      = 22.3;  // Outer width of male lip (mm)
socket_length   = 39.2;  // Front bezel female socket length (0.20 mm FDM clearance) (mm)
socket_width    = 22.7;  // Front bezel female socket width (0.20 mm FDM clearance) (mm)
socket_depth    = 2.7;   // Female socket depth (mm)
snap_ridge_w    = 0.35;  // Snap retention bead projection (mm)
snap_ridge_h    = 1.2;   // Snap retention bead height (mm)
snap_ridge_l    = 14.0;  // Snap retention bead length (mm)
snap_ridge_x    = 8.0;   // Snap bead X position (mm)

/* [Vertical Button Guide Channels & Cutouts] */
btn_x_start     = 26.5;  // Button cutout start X position (mm)
btn_length      = 6.0;   // Button cutout length (mm) -> covers X = 26.5 to 32.5 mm
btn_z_offset    = 0.5;   // Button cutout bottom offset above floor (mm)
btn_height      = 2.5;   // Button cutout height (mm)
btn_groove_d    = 1.2;   // Depth of vertical button slide groove in inner wall (mm)

/* [USB-A & Cable Exit] */
usb_dongle_w    = 16.5;  // Width clearance for USB-A plug & dongle inside bag (mm)
rear_cable_drop = true;  // Pass-through slot in rear floor for cable drop into bag

/* [Backpack Clamping Flange & Screws] */
flange_extend   = 5.5;   // Flange border extension on all sides (mm) -> Outer 52.0 x 35.5 mm
flange_thick    = 1.8;   // Flange thickness (mm)
flange_radius   = 3.0;   // Outer flange fillet radius (mm)
screw_diam      = 2.3;   // M2 clearance hole (mm)
screw_cs_diam   = 4.4;   // M2 countersunk head diameter (mm)
screw_cs_depth  = 1.2;   // Countersink depth (mm)
screw_pilot     = 1.9;   // M2 screw pilot hole diameter for secure bite (mm)

/* [Model Selection] */
// Select component to preview or export:
// "single_print_plate" - Both halves arranged flat on bed for 1-file library printing (RECOMMENDED)
// "front_bezel"        - Front bezel with flush outer flange & snap female socket
// "rear_housing"       - Back enclosure with male snap lip & vertical button slide tracks
// "clamp_ring"         - Inner fabric clamping ring
// "cutout_stencil"     - 1mm template for tracing & punching fabric holes
// "full_suite_plate"   - All 3 parts (Front + Rear + Clamp Ring) on one bed plate
// "assembly_view"      - Exploded visualization showing how components sandwich fabric
part_to_render = "single_print_plate"; // [single_print_plate, front_bezel, rear_housing, clamp_ring, cutout_stencil, full_suite_plate, assembly_view]

$fn = 48;

outer_l = board_length + 2 * wall_thickness; // 41.0 mm
outer_w = board_width + 2 * wall_thickness;  // 24.5 mm
total_flange_l = outer_l + 2 * flange_extend; // 52.0 mm
total_flange_w = outer_w + 2 * flange_extend; // 35.5 mm

base_h = floor_thickness + board_depth; // 7.2 mm (shoulder level)
total_rear_h = base_h + male_lip_h;    // 9.7 mm (top of male lip)

btn_z_bot = floor_thickness + btn_z_offset; // 1.7 mm
btn_z_top = btn_z_bot + btn_height;        // 4.2 mm

male_y0 = (outer_w - male_width) / 2.0;    // 1.1 mm
sock_y0 = (outer_w - socket_width) / 2.0;  // 0.9 mm

// Screw hole coordinates (4 corners)
screw_x1 = -flange_extend / 2;
screw_x2 = outer_l + flange_extend / 2;
screw_y1 = -flange_extend / 2;
screw_y2 = outer_w + flange_extend / 2;

// -----------------------------------------------------------------------------
// HELPER MODULES
// -----------------------------------------------------------------------------
module rounded_rect_2d(length, width, r) {
    translate([r, r])
    minkowski() {
        square([max(0.1, length - 2*r), max(0.1, width - 2*r)]);
        circle(r = r);
    }
}

module rounded_box(length, width, height, r) {
    linear_extrude(height = height)
        rounded_rect_2d(length, width, r);
}

// 100% Manifold Triangular Snap Retention Ridge along X
module snap_ridge_x(length, width, height, dir=1) {
    // dir = 1 points in +Y, dir = -1 points in -Y
    rotate([0, 90, 0])
        linear_extrude(height = length)
        polygon(points = [
            [0, 0],
            [-height/2, dir * width],
            [-height, 0]
        ]);
}

// -----------------------------------------------------------------------------
// 1. FRONT BEZEL CLAMP (Outside of Backpack, with Snap Female Socket)
// -----------------------------------------------------------------------------
module front_bezel() {
    difference() {
        union() {
            // Screen collar (passes through the fabric cutout)
            rounded_box(outer_l, outer_w, collar_height, corner_radius);
            
            // Exterior clamping flange
            translate([-flange_extend, -flange_extend, 0])
                rounded_box(total_flange_l, total_flange_w, flange_thick, flange_radius);
        }
        
        // LCD viewing window (passes completely through front face)
        translate([(outer_l - screen_length)/2, (outer_w - screen_width)/2, -1])
            cube([screen_length, screen_width, collar_height + 2]);
            
        // Inner board seat (Z = screen_lip to top)
        translate([(outer_l - board_length)/2, (outer_w - board_width)/2, screen_lip])
            rounded_box(board_length, board_width, collar_height + 2, corner_radius);
            
        // Female Telescoping Snap Socket (receives Rear Housing male lip)
        // 39.2 x 22.7 mm cavity with 0.20 mm FDM clearance
        translate([(outer_l - socket_length)/2, (outer_w - socket_width)/2, collar_height - socket_depth])
            rounded_box(socket_length, socket_width, socket_depth + 1, corner_radius * 0.7);

        // USB Clearance Cutout (Removes the bar over the USB connector so top sits 100% flush!)
        translate([outer_l - 5, (outer_w - usb_dongle_w)/2, screen_lip])
            cube([flange_extend + 10, usb_dongle_w, collar_height + 2]);

        // Matching snap detent recesses inside female socket walls
        translate([snap_ridge_x, sock_y0 - snap_ridge_w, collar_height - male_lip_h + 0.6])
            cube([snap_ridge_l, snap_ridge_w + 0.05, snap_ridge_h]);
        translate([snap_ridge_x, outer_w - sock_y0 - 0.05, collar_height - male_lip_h + 0.6])
            cube([snap_ridge_l, snap_ridge_w + 0.05, snap_ridge_h]);
            
        // 4x Countersunk M2 Screw Holes
        for (sx = [screw_x1, screw_x2]) {
            for (sy = [screw_y1, screw_y2]) {
                translate([sx, sy, -1])
                    cylinder(d = screw_diam, h = collar_height + 2);
                translate([sx, sy, -0.01])
                    cylinder(d1 = screw_cs_diam, d2 = screw_diam, h = screw_cs_depth);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// 2. REAR HOUSING (Inside Backpack, with Male Snap Lip & Button Slide Channels)
// -----------------------------------------------------------------------------
module rear_housing() {
    difference() {
        union() {
            // Main protective cup base up to shoulder level
            rounded_box(outer_l, outer_w, base_h, corner_radius);
            
            // Rear clamping flange (at shoulder level Z = base_h - flange_thick)
            translate([-flange_extend, -flange_extend, base_h - flange_thick])
                rounded_box(total_flange_l, total_flange_w, flange_thick, flange_radius);
                
            // Corner screw boss support columns
            for (sx = [-flange_extend, outer_l]) {
                for (sy = [-flange_extend, outer_w]) {
                    translate([sx, sy, 0])
                        rounded_box(flange_extend, flange_extend, base_h - flange_thick, 1.0);
                }
            }
            
            // Telescoping Male Snap Lip (38.8 x 22.3 mm, steps in by 1.1 mm shoulder)
            translate([(outer_l - male_length)/2, (outer_w - male_width)/2, base_h])
                rounded_box(male_length, male_width, male_lip_h, corner_radius * 0.7);
                
            // Triangular Snap Retention Beads on the outside of the male lip
            // Front (-Y) snap bead
            translate([snap_ridge_x, male_y0, base_h + 0.6])
                snap_ridge_x(snap_ridge_l, snap_ridge_w, snap_ridge_h, dir=-1);
            // Back (+Y) snap bead
            translate([snap_ridge_x, outer_w - male_y0, base_h + 0.6])
                snap_ridge_x(snap_ridge_l, snap_ridge_w, snap_ridge_h, dir=1);
        }
        
        // --- SUBTRACTIONS ---
        
        // Internal board cavity (37.0 x 20.5 mm) from floor up through top
        translate([(outer_l - board_length)/2, (outer_w - board_width)/2, floor_thickness])
            rounded_box(board_length, board_width, total_rear_h + 5, corner_radius);
            
        // USB-A & Dongle Exit (Wide clearance through end wall & flange so cables/dongles exit freely)
        translate([outer_l - 6, (outer_w - usb_dongle_w)/2, floor_thickness])
            cube([flange_extend + 10, usb_dongle_w, total_rear_h + 5]);
        
        // Side button windows (Z = 1.7 to 4.2 mm, cut through walls for fingertip access)
        translate([btn_x_start, -2, btn_z_bot])
            cube([btn_length, 4, btn_height]);
        translate([btn_x_start, outer_w - 2, btn_z_bot])
            cube([btn_length, 4, btn_height]);
            
        // VERTICAL BUTTON SLIDE-IN GUIDE GROOVES (CHANNELS)
        // 1.2 mm deep recesses from Z = 4.2 mm up to top of male lip (Z = 9.7 mm).
        // The ESP32-S3 GEEK's tactile buttons slide straight down from the top rim
        // into the button windows without catching, while keeping a 0.8 mm outer wall.
        translate([btn_x_start, (outer_w - board_width)/2 - btn_groove_d, btn_z_top - 0.1])
            cube([btn_length, btn_groove_d + 0.1, total_rear_h - btn_z_top + 1]);
        translate([btn_x_start, (outer_w + board_width)/2, btn_z_top - 0.1])
            cube([btn_length, btn_groove_d + 0.1, total_rear_h - btn_z_top + 1]);
            
        // 4x M2 Screw Boss Pilot Holes
        for (sx = [screw_x1, screw_x2]) {
            for (sy = [screw_y1, screw_y2]) {
                translate([sx, sy, base_h - 6.0])
                    cylinder(d = screw_pilot, h = 8);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// 3. INNER CLAMP RING (Fabric clamping frame inside the backpack)
// -----------------------------------------------------------------------------
module clamp_ring() {
    difference() {
        translate([-flange_extend, -flange_extend, 0])
            rounded_box(total_flange_l, total_flange_w, flange_thick, flange_radius);
            
        // Center cutout for body pass-through
        translate([-0.5, -0.5, -1])
            rounded_box(outer_l + 1.0, outer_w + 1.0, flange_thick + 2, corner_radius + 0.5);
            
        // 4x Screw clearance holes
        for (sx = [screw_x1, screw_x2]) {
            for (sy = [screw_y1, screw_y2]) {
                translate([sx, sy, -1])
                    cylinder(d = screw_diam, h = flange_thick + 2);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// 4. FABRIC CUTOUT STENCIL (1mm template to mark & punch backpack fabric)
// -----------------------------------------------------------------------------
module cutout_stencil() {
    difference() {
        translate([-flange_extend, -flange_extend, 0])
            rounded_box(total_flange_l, total_flange_w, 1.0, flange_radius);
            
        // Central fabric hole cutout boundary (with 0.5mm clearance)
        translate([-0.5, -0.5, -1])
            rounded_box(outer_l + 1.0, outer_w + 1.0, 3, corner_radius);
            
        // 4x Corner punch guides (1.5mm holes for fabric awl)
        for (sx = [screw_x1, screw_x2]) {
            for (sy = [screw_y1, screw_y2]) {
                translate([sx, sy, -1])
                    cylinder(d = 1.5, h = 3);
            }
        }
    }
}

// -----------------------------------------------------------------------------
// RENDER DISPATCHER
// -----------------------------------------------------------------------------
if (part_to_render == "single_print_plate") {
    // Both halves oriented flat on print bed (Z = 0) with 10mm gap for 1-file library printing
    front_bezel();
    translate([0, total_flange_w + 10, 0])
        rear_housing();
} else if (part_to_render == "full_suite_plate") {
    // Front Bezel + Rear Housing + Clamp Ring all on one print bed plate
    front_bezel();
    translate([0, total_flange_w + 10, 0])
        rear_housing();
    translate([0, 2 * (total_flange_w + 10), 0])
        clamp_ring();
} else if (part_to_render == "front_bezel") {
    front_bezel();
} else if (part_to_render == "rear_housing") {
    rear_housing();
} else if (part_to_render == "clamp_ring") {
    clamp_ring();
} else if (part_to_render == "cutout_stencil") {
    cutout_stencil();
} else if (part_to_render == "assembly_view") {
    // Exploded visualization
    translate([0, 0, 24]) color([0.25, 0.25, 0.30, 0.9]) front_bezel();
    translate([0, 0, 14]) color([0.2, 0.6, 0.8, 0.4]) clamp_ring();
    color([0.15, 0.15, 0.18, 0.95]) rear_housing();
}
