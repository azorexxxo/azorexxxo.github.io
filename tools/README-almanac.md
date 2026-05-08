# Generator almanachu 2024-2030

Ten folder zawiera skrypt generujący offline'owy almanach dla aplikacji astronawigacyjnej.

## Źródła danych

- NASA/JPL Horizons API: `https://ssd-api.jpl.nasa.gov/doc/horizons.html`
- Endpoint Horizons używany przez skrypt: `https://ssd.jpl.nasa.gov/api/horizons.api`
- Hipparcos Main Catalogue, CDS Strasbourg: `https://cdsarc.cds.unistra.fr/ftp/I/239/version_cd/cats/hip_main.dat.gz`
- Opis pól katalogu Hipparcos: `https://cdsarc.cds.unistra.fr/ftp/I/239/ReadMe`

## Co pobiera skrypt

- Słońce, Księżyc, Wenus, Mars, Jowisz i Saturn z JPL Horizons.
- 57 gwiazd nawigacyjnych z katalogu Hipparcos.
- Dane godzinowe dla ciał Układu Słonecznego od `2024-01-01 00:00:00` do `2031-01-01 00:00:00`.
- Dane dzienne dla gwiazd, SD i HP od `2024-01-01` do `2030-12-31`.

## Jak wygenerować almanach

Uruchom terminal w folderze aplikacji:

```bash
cd /Users/azarkodawid/Desktop/aplikacja
python3 tools/generate-almanac.py --start-year 2024 --end-year 2030
```

Jeżeli chcesz pobrać wszystko od nowa, ignorując cache:

```bash
python3 tools/generate-almanac.py --start-year 2024 --end-year 2030 --force-download
```

## Pliki wyjściowe

- `data/almanac-data.js` - gotowe dane offline ładowane przez `index.html`.
- `data/range.properties` - zakres i opis źródła danych.
- `source-data/horizons/` - cache surowych odpowiedzi NASA/JPL Horizons.
- `source-data/hip_main.dat.gz` - cache katalogu Hipparcos.

Po wygenerowaniu `data/almanac-data.js` aplikacja działa offline z dwukliku na `index.html`.

## Jak to działa w praktyce

Do normalnego używania aplikacji nie trzeba uruchamiać Pythona. Użytkownik otwiera `index.html`, wybiera ciało niebieskie, ustawia datę i czas UTC, a następnie klika `Wypełnij z almanachu`. Aplikacja korzysta wtedy z gotowego pliku `data/almanac-data.js`.

Generator `tools/generate-almanac.py` uruchamia się ręcznie tylko wtedy, gdy trzeba przebudować dane, np. zmienić zakres lat albo pobrać almanach od nowa. Po zakończeniu generator nadpisuje `data/almanac-data.js`; od tego momentu aplikacja może ponownie działać offline.

## Najważniejsze parametry Horizons

- `EPHEM_TYPE='OBSERVER'` - tabela obserwatora.
- `CENTER='500@399'` - geocentrycznie względem Ziemi.
- `STEP_SIZE='1 h'` - dane godzinowe.
- `QUANTITIES='2,13,20'` - RA/Dec, średnica kątowa i odległość.
- `ANG_FORMAT='DEG'` - kąty w stopniach dziesiętnych.
- `CSV_FORMAT='YES'` - tabela łatwa do parsowania.

Skrypt przelicza RA/Dec na dane potrzebne aplikacji:

- `GHA = GAST - RA`
- `SHA = 360° - RA`
- `HP = asin(R_ziemi / odległość)`
- `SD = średnica kątowa / 2`
