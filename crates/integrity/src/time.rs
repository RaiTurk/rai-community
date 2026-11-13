//! UTC calendar buckets for indexes, without a date library.
use hdi::prelude::Timestamp;

pub const HOUR_US: i64 = 3_600_000_000;
pub const DAY_US: i64 = 24 * HOUR_US;

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian (Howard Hinnant's algorithm).
pub fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}
pub fn day_of_us(us: i64) -> String {
    let (y, m, d) = civil(us.div_euclid(DAY_US));
    format!("{y:04}-{m:02}-{d:02}")
}
pub fn month_of_us(us: i64) -> String {
    let (y, m, _) = civil(us.div_euclid(DAY_US));
    format!("{y:04}-{m:02}")
}
pub fn utc_day(ts: Timestamp) -> String {
    day_of_us(ts.as_micros())
}
pub fn utc_month(ts: Timestamp) -> String {
    month_of_us(ts.as_micros())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn calendar() {
        assert_eq!(day_of_us(0), "1970-01-01");
        assert_eq!(day_of_us(-1), "1969-12-31");
        // 2026-11-12T00:00:00Z = 1794441600 s
        assert_eq!(day_of_us(1_794_441_600_000_000), "2026-11-12");
        assert_eq!(day_of_us(1_794_441_600_000_000 - 1), "2026-11-11");
        assert_eq!(month_of_us(1_794_441_600_000_000), "2026-11");
        // 2028-02-29T12:00:00Z
        assert_eq!(day_of_us(1_835_438_400_000_000), "2028-02-29");
    }
}
