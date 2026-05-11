from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"
SOURCE_DIR = ROOT_DIR / "source-data"
HORIZONS_CACHE_DIR = SOURCE_DIR / "horizons"

HORIZONS_API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
HIPPARCOS_URL = "https://cdsarc.cds.unistra.fr/ftp/I/239/version_cd/cats/hip_main.dat.gz"

EARTH_EQUATORIAL_RADIUS_KM = 6378.137
HIPPARCOS_EPOCH = 1991.25

BODY_IDS = {
    "Sun": "10",
    "Moon": "301",
    "Venus": "299",
    "Mars": "499",
    "Jupiter": "599",
    "Saturn": "699",
}

PLANET_ORDER = ["Saturn", "Jupiter", "Mars", "Venus"]

NAV_STARS = [
    (677, "Alpheratz"),
    (2081, "Ankaa"),
    (3179, "Schedar"),
    (3419, "Diphda"),
    (7588, "Achernar"),
    (9884, "Hamal"),
    (13847, "Acamar"),
    (14135, "Menkar"),
    (15863, "Mirfak"),
    (21421, "Aldebaran"),
    (24436, "Rigel"),
    (24608, "Capella"),
    (25336, "Bellatrix"),
    (25428, "Elnath"),
    (26311, "Alnilam"),
    (27989, "Betelgeuse"),
    (30438, "Canopus"),
    (32349, "Sirius"),
    (33579, "Adhara"),
    (37279, "Procyon"),
    (37826, "Pollux"),
    (41037, "Avior"),
    (44816, "Suhail"),
    (45238, "Miaplacidus"),
    (46390, "Alphard"),
    (49669, "Regulus"),
    (54061, "Dubhe"),
    (57632, "Denebola"),
    (59803, "Gienah"),
    (60718, "Acrux"),
    (61084, "Gacrux"),
    (62956, "Alioth"),
    (65474, "Spica"),
    (67301, "Alkaid"),
    (68702, "Hadar"),
    (68933, "Menkent"),
    (69673, "Arcturus"),
    (71683, "Rigil Kentaurus"),
    (72622, "Zubenelgenubi"),
    (72607, "Kochab"),
    (76267, "Alphecca"),
    (80763, "Antares"),
    (82273, "Atria"),
    (84012, "Sabik"),
    (85927, "Shaula"),
    (86032, "Rasalhague"),
    (87833, "Eltanin"),
    (90185, "Kaus Australis"),
    (91262, "Vega"),
    (92855, "Nunki"),
    (97649, "Altair"),
    (100751, "Peacock"),
    (102098, "Deneb"),
    (107315, "Enif"),
    (109268, "Alnair"),
    (113368, "Fomalhaut"),
    (113963, "Markab"),
]


@dataclass(frozen=True)
class HorizonsRow:
    dt: datetime
    ra_deg: float
    dec_deg: float
    angular_diameter_arcsec: float
    delta_km: float


@dataclass(frozen=True)
class HipparcosStar:
    hip: int
    name: str
    ra_deg: float
    dec_deg: float
    pm_ra_mas_per_year: float
    pm_dec_mas_per_year: float


def log(message: str) -> None:
    print(message, flush=True)


def normalize360(value: float) -> float:
    return value % 360.0


def safe_float(text: str, fallback: float = 0.0) -> float:
    cleaned = str(text).strip()
    if not cleaned:
        return fallback
    try:
        return float(cleaned)
    except ValueError:
        return fallback


def julian_date(dt: datetime) -> float:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)

    year = dt.year
    month = dt.month
    day = dt.day + (
        dt.hour + (dt.minute + (dt.second + dt.microsecond / 1_000_000) / 60) / 60
    ) / 24

    if month <= 2:
        year -= 1
        month += 12

    a = math.floor(year / 100)
    b = 2 - a + math.floor(a / 4)

    return (
        math.floor(365.25 * (year + 4716))
        + math.floor(30.6001 * (month + 1))
        + day
        + b
        - 1524.5
    )


def gast_degrees(dt: datetime) -> float:
    jd = julian_date(dt)
    t = (jd - 2451545.0) / 36525.0
    gmst = (
        280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * t * t
        - (t * t * t) / 38710000.0
    )

    mean_sun_longitude = math.radians(normalize360(280.4665 + 36000.7698 * t))
    mean_moon_longitude = math.radians(normalize360(218.3165 + 481267.8813 * t))
    moon_node = math.radians(normalize360(125.04452 - 1934.136261 * t))
    obliquity = math.radians(23.439291 - 0.0130042 * t)

    nutation_longitude_arcsec = (
        -17.20 * math.sin(moon_node)
        - 1.32 * math.sin(2 * mean_sun_longitude)
        - 0.23 * math.sin(2 * mean_moon_longitude)
        + 0.21 * math.sin(2 * moon_node)
    )
    equation_of_equinoxes = (nutation_longitude_arcsec * math.cos(obliquity)) / 3600.0

    return normalize360(gmst + equation_of_equinoxes)


def decimal_year(dt: datetime) -> float:
    start = datetime(dt.year, 1, 1, tzinfo=timezone.utc)
    end = datetime(dt.year + 1, 1, 1, tzinfo=timezone.utc)
    return dt.year + (dt - start).total_seconds() / (end - start).total_seconds()


def precess_j2000_to_date(ra_deg: float, dec_deg: float, dt: datetime) -> tuple[float, float]:
    jd = julian_date(dt)
    t = (jd - 2451545.0) / 36525.0

    zeta = math.radians((2306.2181 * t + 0.30188 * t * t + 0.017998 * t**3) / 3600.0)
    z = math.radians((2306.2181 * t + 1.09468 * t * t + 0.018203 * t**3) / 3600.0)
    theta = math.radians((2004.3109 * t - 0.42665 * t * t - 0.041833 * t**3) / 3600.0)

    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)

    a = math.cos(dec) * math.sin(ra + zeta)
    b = (
        math.cos(theta) * math.cos(dec) * math.cos(ra + zeta)
        - math.sin(theta) * math.sin(dec)
    )
    c = (
        math.sin(theta) * math.cos(dec) * math.cos(ra + zeta)
        + math.cos(theta) * math.sin(dec)
    )

    precessed_ra = normalize360(math.degrees(math.atan2(a, b) + z))
    precessed_dec = math.degrees(math.asin(max(-1.0, min(1.0, c))))

    return precessed_ra, precessed_dec


def star_ra_dec_for_date(star: HipparcosStar, dt: datetime) -> tuple[float, float]:
    years = decimal_year(dt) - HIPPARCOS_EPOCH
    dec_rad = math.radians(star.dec_deg)
    cos_dec = max(1e-9, abs(math.cos(dec_rad)))

    ra_pm_deg = (star.pm_ra_mas_per_year / cos_dec) * years / 3_600_000.0
    dec_pm_deg = star.pm_dec_mas_per_year * years / 3_600_000.0

    moved_ra = normalize360(star.ra_deg + ra_pm_deg)
    moved_dec = star.dec_deg + dec_pm_deg

    return precess_j2000_to_date(moved_ra, moved_dec, dt)


def degrees_to_dm(value: float, wrap: bool = False) -> str:
    if wrap:
        value = normalize360(value)

    sign = "-" if value < 0 else ""
    absolute = abs(value)
    degrees = int(math.floor(absolute))
    minutes = (absolute - degrees) * 60.0

    if round(minutes, 1) >= 60.0:
        degrees += 1
        minutes = 0.0

    return f"{sign}{degrees:02d}:{minutes:04.1f}"


def arcminutes(value: float) -> str:
    rounded = round(value, 1)
    if rounded == -0.0:
        rounded = 0.0
    return f"{rounded:.1f}"


def timestamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:00:00")


def date_stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def iter_days(start_year: int, end_year: int) -> list[datetime]:
    current = datetime(start_year, 1, 1, tzinfo=timezone.utc)
    end = datetime(end_year + 1, 1, 1, tzinfo=timezone.utc)
    days: list[datetime] = []
    while current < end:
        days.append(current)
        current += timedelta(days=1)
    return days


def horizons_time(year: int) -> str:
    return f"{year}-Jan-01 00:00"


def request_url(params: dict[str, str]) -> str:
    return HORIZONS_API_URL + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def download_text(url: str, timeout: int = 180, retries: int = 3) -> str:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return response.read().decode("utf-8", errors="replace")
        except Exception as error:
            last_error = error
            if attempt < retries:
                time.sleep(2 * attempt)
    raise RuntimeError(f"Nie udalo sie pobrac URL: {url}\n{last_error}")


def fetch_horizons_body_year(body: str, year: int, force_download: bool) -> str:
    HORIZONS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = HORIZONS_CACHE_DIR / f"{body.lower()}_{year}.txt"

    if cache_path.exists() and not force_download:
        return cache_path.read_text(encoding="utf-8")

    params = {
        "format": "text",
        "COMMAND": f"'{BODY_IDS[body]}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'500@399'",
        "START_TIME": f"'{horizons_time(year)}'",
        "STOP_TIME": f"'{horizons_time(year + 1)}'",
        "STEP_SIZE": "'1 h'",
        "QUANTITIES": "'2,13,20'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
        "TIME_DIGITS": "'SECONDS'",
        "TIME_TYPE": "'UT'",
        "RANGE_UNITS": "'KM'",
        "EXTRA_PREC": "'YES'",
    }
    url = request_url(params)
    log(f"Pobieram JPL Horizons: {body} {year}")
    text = download_text(url)

    if "$$SOE" not in text or "$$EOE" not in text:
        raise RuntimeError(f"Horizons nie zwrocil tabeli dla {body} {year}. URL: {url}")

    cache_path.write_text(text, encoding="utf-8")
    return text


def parse_horizons_datetime(value: str) -> datetime:
    return datetime.strptime(value.strip(), "%Y-%b-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def parse_horizons_rows(text: str) -> dict[str, HorizonsRow]:
    in_table = False
    rows: dict[str, HorizonsRow] = {}

    for raw_line in text.splitlines():
        line = raw_line.rstrip()

        if line.strip() == "$$SOE":
            in_table = True
            continue
        if line.strip() == "$$EOE":
            break
        if not in_table or not line.strip():
            continue

        parsed = next(csv.reader([line]))
        if len(parsed) < 7:
            continue

        dt = parse_horizons_datetime(parsed[0])
        row = HorizonsRow(
            dt=dt,
            ra_deg=safe_float(parsed[3]),
            dec_deg=safe_float(parsed[4]),
            angular_diameter_arcsec=safe_float(parsed[5]),
            delta_km=safe_float(parsed[6]),
        )
        rows[timestamp(dt)] = row

    return rows


def load_solar_system_data(
    start_year: int, end_year: int, force_download: bool
) -> dict[str, dict[str, HorizonsRow]]:
    result: dict[str, dict[str, HorizonsRow]] = {}
    for body in BODY_IDS:
        body_rows: dict[str, HorizonsRow] = {}
        for year in range(start_year, end_year + 1):
            text = fetch_horizons_body_year(body, year, force_download)
            body_rows.update(parse_horizons_rows(text))
        result[body] = body_rows
        log(f"  {body}: {len(body_rows)} wierszy godzinowych")
    return result


def semi_diameter_minutes(row: HorizonsRow) -> float:
    return row.angular_diameter_arcsec / 120.0


def horizontal_parallax_minutes(row: HorizonsRow) -> float:
    if row.delta_km <= 0:
        return 0.0
    angle_rad = math.asin(min(1.0, EARTH_EQUATORIAL_RADIUS_KM / row.delta_km))
    return math.degrees(angle_rad) * 60.0


def gha_from_ra(row: HorizonsRow) -> float:
    return normalize360(gast_degrees(row.dt) - row.ra_deg)


def write_csv_text(headers: list[str], rows: list[list[str]]) -> str:
    output = io.StringIO()
    writer = csv.writer(output, delimiter=";", lineterminator="\n")
    writer.writerow(headers)
    writer.writerows(rows)
    return output.getvalue()


def build_sun_moon_csv(solar: dict[str, dict[str, HorizonsRow]]) -> str:
    rows: list[list[str]] = []
    common_timestamps = sorted(set(solar["Sun"]) & set(solar["Moon"]))

    for key in common_timestamps:
        sun = solar["Sun"][key]
        moon = solar["Moon"][key]
        rows.append(
            [
                key,
                degrees_to_dm(gha_from_ra(sun), wrap=True),
                degrees_to_dm(sun.dec_deg),
                degrees_to_dm(gha_from_ra(moon), wrap=True),
                "0.0",
                degrees_to_dm(moon.dec_deg),
                "0.0",
                arcminutes(horizontal_parallax_minutes(moon)),
            ]
        )

    return write_csv_text(
        ["Timestamp", "sun_GHA", "sun_DECL", "moon_GHA", "moon_v", "moon_DECL", "moon_d", "moon_HP"],
        rows,
    )


def build_planets_csv(solar: dict[str, dict[str, HorizonsRow]]) -> str:
    rows: list[list[str]] = []
    timestamps = sorted(set.intersection(*(set(solar[body]) for body in PLANET_ORDER)))

    for key in timestamps:
        dt = solar[PLANET_ORDER[0]][key].dt
        row = [key, degrees_to_dm(gast_degrees(dt), wrap=True)]

        for body in PLANET_ORDER:
            body_row = solar[body][key]
            row.extend(
                [
                    degrees_to_dm(gha_from_ra(body_row), wrap=True),
                    degrees_to_dm(body_row.dec_deg),
                    arcminutes(semi_diameter_minutes(body_row)),
                ]
            )
        rows.append(row)

    return write_csv_text(
        [
            "Timestamp",
            "aries_GHA",
            "saturn_GHA",
            "saturn_DECL",
            "saturn_SD",
            "jupiter_GHA",
            "jupiter_DECL",
            "jupiter_SD",
            "mars_GHA",
            "mars_DECL",
            "mars_SD",
            "venus_GHA",
            "venus_DECL",
            "venus_SD",
        ],
        rows,
    )


def build_sun_moon_sd_csv(
    solar: dict[str, dict[str, HorizonsRow]], start_year: int, end_year: int
) -> str:
    rows: list[list[str]] = []
    for day in iter_days(start_year, end_year):
        key = timestamp(day)
        rows.append(
            [
                date_stamp(day),
                arcminutes(semi_diameter_minutes(solar["Sun"][key])),
                arcminutes(semi_diameter_minutes(solar["Moon"][key])),
            ]
        )

    return write_csv_text(["Timestamp", "sun_SD", "moon_SD"], rows)


def build_venus_mars_hp_csv(
    solar: dict[str, dict[str, HorizonsRow]], start_year: int, end_year: int
) -> str:
    rows: list[list[str]] = []
    for day in iter_days(start_year, end_year):
        key = timestamp(day)
        rows.append(
            [
                date_stamp(day),
                arcminutes(horizontal_parallax_minutes(solar["Venus"][key])),
                arcminutes(horizontal_parallax_minutes(solar["Mars"][key])),
            ]
        )

    return write_csv_text(["Timestamp", "venus_HP", "mars_HP"], rows)


def download_hipparcos(force_download: bool) -> Path:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = SOURCE_DIR / "hip_main.dat.gz"

    if cache_path.exists() and not force_download:
        return cache_path

    log("Pobieram katalog Hipparcos z CDS Strasbourg")
    with urllib.request.urlopen(HIPPARCOS_URL, timeout=300) as response:
        cache_path.write_bytes(response.read())
    return cache_path


def parse_hipparcos_stars(path: Path) -> dict[int, HipparcosStar]:
    selected = {hip: name for hip, name in NAV_STARS}
    stars: dict[int, HipparcosStar] = {}

    with gzip.open(path, "rt", encoding="latin-1") as handle:
        for line in handle:
            hip_text = line[8:14].strip()
            if not hip_text:
                continue

            hip = int(hip_text)
            if hip not in selected:
                continue

            ra = safe_float(line[51:63])
            dec = safe_float(line[64:76])
            pm_ra = safe_float(line[87:95])
            pm_dec = safe_float(line[96:104])

            stars[hip] = HipparcosStar(
                hip=hip,
                name=selected[hip],
                ra_deg=ra,
                dec_deg=dec,
                pm_ra_mas_per_year=pm_ra,
                pm_dec_mas_per_year=pm_dec,
            )

    missing = [f"{hip} {name}" for hip, name in NAV_STARS if hip not in stars]
    if missing:
        raise RuntimeError("Brakuje gwiazd w Hipparcos: " + ", ".join(missing))

    return stars


def build_stars_csv(stars: dict[int, HipparcosStar], start_year: int, end_year: int) -> str:
    rows: list[list[str]] = []
    days = iter_days(start_year, end_year)

    for day_index, day in enumerate(days, start=1):
        if day_index == 1 or day_index % 365 == 0:
            log(f"Licze gwiazdy: {date_stamp(day)}")

        for hip, _name in NAV_STARS:
            star = stars[hip]
            ra, dec = star_ra_dec_for_date(star, day)
            sha = normalize360(360.0 - ra)
            rows.append(
                [
                    date_stamp(day),
                    star.name,
                    degrees_to_dm(sha, wrap=True),
                    degrees_to_dm(dec),
                ]
            )

    return write_csv_text(["Timestamp", "Name", "SHA", "DECL"], rows)


def write_almanac_js(csv_files: dict[str, str]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_path = DATA_DIR / "almanac-data.js"
    js_payload = json.dumps(csv_files, ensure_ascii=False, separators=(",", ":"))
    output_path.write_text(f"window.ALMANAC_CSV={js_payload};\n", encoding="utf-8")
    log(f"Zapisano {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MB)")


def write_range_properties(start_year: int, end_year: int) -> None:
    path = DATA_DIR / "range.properties"
    text = (
        f"source=NASA/JPL Horizons API + Hipparcos Main Catalogue (CDS)\n"
        f"start_year={start_year}\n"
        f"end_year={end_year}\n"
        f"generated_utc={datetime.now(timezone.utc).isoformat(timespec='seconds')}\n"
    )
    path.write_text(text, encoding="utf-8")


def generate(start_year: int, end_year: int, force_download: bool) -> None:
    if start_year > end_year:
        raise ValueError("start-year nie moze byc wiekszy od end-year")

    log(f"Generuje almanach offline: {start_year}-{end_year}")
    solar = load_solar_system_data(start_year, end_year, force_download)
    hipparcos_path = download_hipparcos(force_download)
    stars = parse_hipparcos_stars(hipparcos_path)
    log(f"Hipparcos: zaladowano {len(stars)} gwiazd nawigacyjnych")

    csv_files = {
        "sun-moon.csv": build_sun_moon_csv(solar),
        "planets.csv": build_planets_csv(solar),
        "sun-moon-sd.csv": build_sun_moon_sd_csv(solar, start_year, end_year),
        "venus-mars-hp.csv": build_venus_mars_hp_csv(solar, start_year, end_year),
        "stars.csv": build_stars_csv(stars, start_year, end_year),
    }

    write_almanac_js(csv_files)
    write_range_properties(start_year, end_year)
    log("Gotowe. Po tym kroku aplikacja dziala offline z wygenerowanym almanachem.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate offline almanac data for the app.")
    parser.add_argument("--start-year", type=int, default=2024)
    parser.add_argument("--end-year", type=int, default=2030)
    parser.add_argument(
        "--force-download",
        action="store_true",
        help="Ignore cached source files and download everything again.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        generate(args.start_year, args.end_year, args.force_download)
    except Exception as error:
        print(f"BLAD: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
