//! Where windows open and when they stay hidden. Only numbers here, no windows,
//! so the rules are tested apart from Tauri (desktop.rs, quick.rs and settings.rs apply them).

use std::time::{Duration, Instant};
use tauri::{PhysicalPosition, PhysicalRect, PhysicalSize};

/// work area of a monitor: the screen without the taskbar
pub type Area = PhysicalRect<i32, u32>;

/// with this flag the app starts at Windows sign-in: without the main window
pub const HIDDEN_ARG: &str = "--hidden";
/// agenda size in logical pixels and the margin from the work area corner
pub const AGENDA_SIZE: (f64, f64) = (340.0, 440.0);
const AGENDA_MARGIN: f64 = 12.0;
/// a click on the tray icon takes focus from the agenda first: the agenda hides, and the same click must not reopen it
const REOPEN_PAUSE: Duration = Duration::from_millis(400);
/// the settings window keeps this margin to the work area height and is never shorter than the minimum, logical pixels
const SETTINGS_MARGIN: f64 = 48.0;
const SETTINGS_MIN_HEIGHT: f64 = 320.0;

/// Started by Windows at sign-in: by the flag (Run key) or by the activation kind (MSIX)
pub fn starts_hidden(mut args: impl Iterator<Item = String>, at_startup: bool) -> bool {
    args.any(|a| a == HIDDEN_ARG) || at_startup
}

/// The agenda hid on focus loss a moment ago, so this click is the one that took the focus
pub fn recently_hidden(hidden_at: Option<Instant>, now: Instant) -> bool {
    hidden_at.is_some_and(|at| now.duration_since(at) < REOPEN_PAUSE)
}

fn right_bottom(area: &Area) -> (i32, i32) {
    (area.position.x + area.size.width as i32, area.position.y + area.size.height as i32)
}

/// Bottom right corner of the work area of the monitor with the icon: like system flyouts
pub fn agenda_position(area: &Area, scale: f64) -> PhysicalPosition<i32> {
    let (w, h) = AGENDA_SIZE;
    let (right, bottom) = right_bottom(area);
    PhysicalPosition::new(
        right - ((w + AGENDA_MARGIN) * scale) as i32,
        bottom - ((h + AGENDA_MARGIN) * scale) as i32,
    )
}

/// Upper part of the screen, centered: like Windows search
pub fn quick_position(area: &Area, scale: f64, width: f64) -> PhysicalPosition<i32> {
    let width = (width * scale) as i32;
    PhysicalPosition::new(
        area.position.x + (area.size.width as i32 - width) / 2,
        area.position.y + area.size.height as i32 / 4,
    )
}

/// No taller than the work area of the main window's monitor (logical pixels), with a margin
pub fn settings_height(preferred: f64, work_height: Option<f64>) -> f64 {
    match work_height {
        Some(h) => preferred.min(h - SETTINGS_MARGIN).max(SETTINGS_MIN_HEIGHT),
        None => preferred,
    }
}

/// Centered on the main window, but entirely inside the work area of its monitor
pub fn centered(
    main: PhysicalPosition<i32>,
    main_size: PhysicalSize<u32>,
    own: PhysicalSize<u32>,
    area: Option<&Area>,
) -> PhysicalPosition<i32> {
    let (w, h) = (own.width as i32, own.height as i32);
    let x = main.x + (main_size.width as i32 - w) / 2;
    let y = main.y + (main_size.height as i32 - h) / 2;
    let Some(area) = area else { return PhysicalPosition::new(x, y) };
    let (left, top) = (area.position.x, area.position.y);
    let (right, bottom) = right_bottom(area);
    PhysicalPosition::new(x.clamp(left, (right - w).max(left)), y.clamp(top, (bottom - h).max(top)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn area(x: i32, y: i32, width: u32, height: u32) -> Area {
        PhysicalRect { position: PhysicalPosition::new(x, y), size: PhysicalSize::new(width, height) }
    }

    fn at(x: i32, y: i32) -> PhysicalPosition<i32> {
        PhysicalPosition::new(x, y)
    }

    fn size(width: u32, height: u32) -> PhysicalSize<u32> {
        PhysicalSize::new(width, height)
    }

    #[test]
    fn sign_in_launch_starts_without_the_main_window() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>().into_iter();
        assert!(starts_hidden(args(&["calm.exe", "--hidden"]), false));
        assert!(starts_hidden(args(&["calm.exe"]), true));
        assert!(!starts_hidden(args(&["calm.exe", "--hidden-not"]), false));
    }

    #[test]
    fn click_that_hid_the_agenda_does_not_reopen_it() {
        let now = Instant::now();
        assert!(recently_hidden(Some(now), now + Duration::from_millis(399)));
        assert!(!recently_hidden(Some(now), now + Duration::from_millis(400)));
        assert!(!recently_hidden(None, now));
    }

    #[test]
    fn agenda_sits_in_the_bottom_right_corner_of_the_work_area() {
        // 1920×1040 work area at 100%: 340×440 window with a 12 px margin
        assert_eq!(agenda_position(&area(0, 0, 1920, 1040), 1.0), at(1920 - 352, 1040 - 452));
        // second monitor to the left at 150%
        assert_eq!(agenda_position(&area(-2560, 100, 2560, 1400), 1.5), at(-528, 100 + 1400 - 678));
    }

    #[test]
    fn quick_add_opens_centered_a_quarter_from_the_top() {
        assert_eq!(quick_position(&area(0, 0, 1920, 1040), 1.0, 520.0), at(700, 260));
        assert_eq!(quick_position(&area(1920, 40, 2560, 1400), 2.0, 520.0), at(1920 + 760, 40 + 350));
    }

    #[test]
    fn settings_window_fits_short_screens() {
        assert_eq!(settings_height(560.0, None), 560.0);
        assert_eq!(settings_height(560.0, Some(1040.0)), 560.0);
        assert_eq!(settings_height(560.0, Some(600.0)), 552.0);
        assert_eq!(settings_height(560.0, Some(300.0)), 320.0);
    }

    #[test]
    fn settings_open_centered_on_the_main_window() {
        assert_eq!(centered(at(100, 50), size(1200, 800), size(720, 560), None), at(340, 170));
        let screen = area(0, 0, 1920, 1040);
        assert_eq!(centered(at(100, 50), size(1200, 800), size(720, 560), Some(&screen)), at(340, 170));
    }

    #[test]
    fn settings_stay_on_the_screen_when_the_main_window_is_off_it() {
        let screen = area(0, 0, 1920, 1040);
        assert_eq!(centered(at(-900, -500), size(1200, 800), size(720, 560), Some(&screen)), at(0, 0));
        assert_eq!(centered(at(1500, 700), size(1200, 800), size(720, 560), Some(&screen)), at(1200, 480));
        // a window bigger than the screen sticks to its top left corner
        assert_eq!(centered(at(0, 0), size(800, 600), size(2000, 1200), Some(&screen)), at(0, 0));
    }
}
