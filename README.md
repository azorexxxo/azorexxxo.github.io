# Aplikacja astronawigacyjna

Aplikacja webowa do wyznaczania pozycji obserwatora na podstawie obserwacji astronawigacyjnych. Program działa w przeglądarce i może korzystać z lokalnego, wcześniej wygenerowanego almanachu.

## Link do aplikacji

Po włączeniu GitHub Pages link będzie miał postać:

```text
https://NAZWA-UZYTKOWNIKA.github.io/NAZWA-REPO/
```

Po uzyskaniu właściwego linku z GitHuba można wkleić go tutaj:

```text
LINK_DO_APLIKACJI
```

## Jak uruchomić aplikację lokalnie

Najprościej otworzyć plik:

```text
index.html
```

Aplikacja ładuje plik:

```text
data/almanac-data.js
```

Dzięki temu po wygenerowaniu danych może działać offline.

## Jak używać aplikacji

1. Wpisz pozycję przybliżoną DR.
2. Wpisz dane środowiskowe, np. wysokość oka, temperaturę, ciśnienie i poprawkę indeksu IC.
3. Wybierz ciało niebieskie.
4. Ustaw datę i czas UTC.
5. Kliknij `Wypełnij z almanachu`, aby aplikacja uzupełniła GHA, deklinację, SHA, SD i HP.
6. Wpisz wysokość sekstantową Hs.
7. Kliknij `Dodaj obserwację`.
8. Dodaj minimum dwie obserwacje.
9. Kliknij `Oblicz pozycję`.

## Almanach offline

Do normalnego używania aplikacji nie trzeba uruchamiać Pythona. Aplikacja korzysta z gotowego pliku:

```text
data/almanac-data.js
```

Ten plik zawiera dane almanachu na lata 2024-2030. Jeżeli plik znajduje się w repozytorium, aplikacja może działać także po otwarciu z GitHub Pages.

## Tryb offline na telefonie

Aplikacja ma dodany tryb PWA. Żeby używać jej offline na telefonie:

1. Wejdź w link GitHub Pages, mając internet.
2. Poczekaj, aż aplikacja w pełni się załaduje, szczególnie plik almanachu.
3. Na iPhonie otwórz Safari, kliknij udostępnianie i wybierz `Do ekranu początkowego`.
4. Na Androidzie otwórz Chrome, wejdź w menu i wybierz `Dodaj do ekranu głównego` albo `Zainstaluj aplikację`.
5. Po zapisaniu aplikacji na ekranie telefonu można ją uruchomić bez internetu.

Tryb offline działa po wejściu przez `https://`, np. GitHub Pages. Nie działa przy zwykłym otwarciu pliku `index.html` przez `file://`, bo przeglądarki nie uruchamiają wtedy service workera.

## Generator almanachu

Generator znajduje się w pliku:

```text
tools/generate-almanac.py
```

Uruchamia się go ręcznie tylko wtedy, gdy trzeba przebudować dane almanachu, np. zmienić zakres lat albo pobrać dane od nowa.

Komenda do wygenerowania almanachu 2024-2030:

```bash
cd /Users/azarkodawid/Desktop/aplikacja
python3 tools/generate-almanac.py --start-year 2024 --end-year 2030
```

Komenda wymuszająca pobranie danych od nowa:

```bash
python3 tools/generate-almanac.py --start-year 2024 --end-year 2030 --force-download
```

Po zakończeniu generator nadpisuje:

```text
data/almanac-data.js
```

## Źródła danych

Almanach generowany jest na podstawie danych z następujących źródeł:

- NASA/JPL Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- Endpoint Horizons: https://ssd.jpl.nasa.gov/api/horizons.api
- Plik danych Hipparcos pobierany przez generator: https://cdsarc.cds.unistra.fr/ftp/I/239/version_cd/cats/hip_main.dat.gz
- Dokumentacja katalogu Hipparcos, czyli opis kolumn i formatu pliku: https://cdsarc.cds.unistra.fr/ftp/I/239/ReadMe

Generator automatycznie pobiera tylko plik `hip_main.dat.gz`. Link `ReadMe` jest potrzebny jako dokumentacja źródła danych i wyjaśnienie, które kolumny katalogu są używane.

## Zakres danych

Generator pobiera i przelicza:

- Słońce, Księżyc, Wenus, Mars, Jowisz i Saturn z NASA/JPL Horizons.
- 57 gwiazd nawigacyjnych z katalogu Hipparcos.
- Dane godzinowe dla ciał Układu Słonecznego od `2024-01-01 00:00:00` do `2031-01-01 00:00:00`.
- Dane dla gwiazd, SD i HP od `2024-01-01` do `2030-12-31`.

Dodatkowy punkt `2031-01-01 00:00:00` jest potrzebny do interpolacji obserwacji wykonanych pod koniec 2030 roku.

## Najważniejsze przeliczenia almanachu

Skrypt pobiera z Horizons rektascensję, deklinację, średnicę kątową i odległość, a następnie przelicza dane do formatu używanego przez aplikację:

```text
GHA = GAST - RA
SHA = 360° - RA
HP = asin(R_ziemi / odległość)
SD = średnica kątowa / 2
```

## Pliki w repozytorium

Najważniejsze pliki projektu:

- `index.html` - struktura aplikacji.
- `style.css` - wygląd aplikacji.
- `app.js` - obsługa formularzy, almanachu i tabeli obserwacji.
- `calculations.js` - obliczenia astronawigacyjne.
- `data/almanac-data.js` - gotowy almanach offline.
- `service-worker.js` - zapis plików aplikacji do działania offline w przeglądarce.
- `manifest.webmanifest` - konfiguracja instalacji aplikacji na telefonie.
- `icons/app-icon.svg` - ikona aplikacji.
- `tools/generate-almanac.py` - generator almanachu.
- `data/range.properties` - informacja o zakresie wygenerowanych danych.

## Pliki ignorowane

Do repozytorium nie trzeba wrzucać:

- `source-data/` - cache surowych odpowiedzi z API.
- `data/*.csv` - stare pliki CSV, jeżeli są używane tylko pomocniczo.
- `data/*.pdf` - stare pliki PDF almanachu.
- `.DS_Store` - pliki systemowe macOS.

Do działania aplikacji z GitHub Pages potrzebny jest gotowy plik `data/almanac-data.js`.
