
const observations= [];
const STORAGE_KEY = "celestialFixSessions";

const elements = {
    datetimeUtc: document.querySelector("#datetime-utc"),
    setCurrentUtc: document.querySelector("#set-current-utc"),
    fillFromAlmanac: document.querySelector("#fill-from-almanac"),
    observationForm: document.querySelector("#observation-form"),
    observationsTable: document.querySelector("#observations-table"),
    clearObservations: document.querySelector("#clear-observations"),
    calculateFix: document.querySelector("#calculate-fix"),
    resultLat: document.querySelector("#result-lat"),
    resultLon: document.querySelector("#result-lon"),
    resultCount: document.querySelector("#result-count"),
    sessionName: document.querySelector("#session-name"),
    saveSession: document.querySelector("#save-session"),
    loadSession: document.querySelector("#load-session"),
    savedSessions: document.querySelector("#saved-sessions"),
};

const almanacCache = new Map();

const planets = new Set(["Saturn", "Venus", "Mars", "Jupiter"]);

function byId(id) {
    return document.querySelector(`#${id}`);
}

function getCurrentUtcDataTimeLocalValue() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");
    const seconds = String(now.getUTCSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function setCurrentUtcDateTime () {
    if (elements.datetimeUtc) {
        elements.datetimeUtc.value = getCurrentUtcDataTimeLocalValue();
    }
}

function setDefaultUtcDateTime() {
    if (elements.datetimeUtc || elements.datetimeUtc.value) {
    return;
    }
    setCurrentUtcDateTime();
}

function parseUtcDateTimeInput(value = getInputValue("#datetime-utc")) {
  if (!value) {
    return null;
  }

  let normalized = String(value).trim();

  if (normalized.includes(" ") && !normalized.includes("T")) {
    normalized = normalized.replace(" ", "T");
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    normalized = `${normalized}T00:00:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    normalized = `${normalized}:00`;
  }

  const date = new Date(`${normalized}Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatUtcDate(date) {
    if (!date || Number.isNaN(date.getTime())){
        throw new Error("Nieprawidłowy czas UTC.");
    }
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatAlmanacTimestamp (date) {
    if (!date || Number.isNaN(date.getTime())
    )
{
throw new Error("Nieprawidłowy czas UTC.");
}
    const day= formatUtcDate(date);
    const hour = String(date.getUTCHours()).padStart(2, "0");
    return `${day} ${hour}:00:00`;
}

function floorToUtcHour(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(),
    0,
    0,
    0
));
}

function addUtcHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getInputValue(selector) {
    const input= document.querySelector(selector);
    return input ? input.value.trim() : "";
}
function setInputValue(selector, value) {
    const input = document.querySelector(selector);
    if (input) {
        input.value = value ?? "";
    }
}

function getNumberValue(selector, fallback = 0) {
    const value = getInputValue(selector).replace(",", ".");
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}
    function getDeadReckoningData() {
        return {
            lat: getNumberValue("#dr-lat"),
            lon: getNumberValue("#dr-lon"),
            eyeHeight: getNumberValue("#eye-height"),
            temperature: getNumberValue("#temperature"),
            pressure: getNumberValue("#pressure"),
            indexError: getNumberValue("#index-error"),
        };
    }

    function setDeadReckoningData(data) {
        setInputValue("#dr-lat", data.lat);
        setInputValue("#dr-lon", data.lon);
        setInputValue("#eye-height", data.eyeHeight);
        setInputValue("#temperature", data.temperature);
        setInputValue("#pressure", data.pressure);
        setInputValue("#index-error", data.indexError);
    }

  function parseCsv(text) {
  const cleanedText = text.replace(/^\uFEFF/, "");
  const lines = cleanedText.trim().split(/\r?\n/);
  const headers = lines.shift().split(";").map((header) => header.trim());

  return lines.map((line) => {
    const values = line.split(";");
    const row = {};

    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });

    return row;
  });
}
        async function loadAlmanacCsv(fileName) {
  if (almanacCache.has(fileName)) {
    return almanacCache.get(fileName);
  }

  if (window.ALMANAC_CSV && window.ALMANAC_CSV[fileName]) {
    const rows = parseCsv(window.ALMANAC_CSV[fileName]);
    almanacCache.set(fileName, rows);
    return rows;
  }

  const path = `data/${fileName}`;
  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`Nie udało się wczytać pliku ${path}.`);
  }

  const rows = parseCsv(await response.text());
  almanacCache.set(fileName, rows);

  return rows;
}
        function findRowByTimestamp(rows, timestamp) {
            return rows.find((row) => String(row.Timestamp).trim() === timestamp) ?? null;
        }
        function findDailyRow (rows, dateString, predicate = () => true) {
            let date = new Date(`${dateString}T00:00:00Z`);
            for (let i = 0; i<= 4; i += 1) {
                const currentDate = formatUtcDate(date);
                const row = rows.find((item) => item.Timestamp === currentDate && predicate(item));
                if (row) {
                    return row;
                }
                date = addUtcHours(date, -24);
            }
            return null;
        }
        function normalizeName(value) {
            return String(value) 
            .toLowerCase()
            .replaceAll(".", "")
            .replaceAll("'", "")
            .replace(/\s+/g, " ")
            .trim();
        }
        function requireRow(row, description) {
            if (!row) {
                throw new Error(`Nie można znaleźć danych almanachu dla ${description}`);
            }
            return row;
        }

        async function getAlmanacValues(body, datetime) {
            const hour0= floorToUtcHour(datetime);
            const hour1 = addUtcHours(hour0, 1);
            const timestamp0 = formatAlmanacTimestamp(hour0);
            const timestamp1 = formatAlmanacTimestamp(hour1);
            const dateString = formatUtcDate(datetime);
        if (body === "Sun" || body === "Moon"){
            const prefix = body.toLowerCase();
            const sunMoonRows = await loadAlmanacCsv("sun-moon.csv");
            const sdRows = await loadAlmanacCsv("sun-moon-sd.csv");
            const row0 = requireRow(findRowByTimestamp(sunMoonRows, timestamp0), timestamp0);
            const row1 = requireRow(findRowByTimestamp(sunMoonRows, timestamp1), timestamp1);
            const sdRow0 = requireRow(findDailyRow(sdRows, dateString), dateString);
            const hp = body === "Moon"
  ? row0.moon_HP || row0["moon_HP"] || row0._values?.[7] || "0"
  : "0";

return {
  gha0: row0[`${prefix}_GHA`],
  gha1: row1[`${prefix}_GHA`],
  dec0: row0[`${prefix}_DECL`],
  dec1: row1[`${prefix}_DECL`],
  sha: "",
  sd: sdRow0[`${prefix}_SD`] || "0",
  hp
};
        }
        if (planets.has(body)) {
            const prefix = body.toLowerCase();
            const planetRows = await loadAlmanacCsv("planets.csv");

            const row0 = requireRow(findRowByTimestamp(planetRows, timestamp0), timestamp0);
            const row1 = requireRow(findRowByTimestamp(planetRows, timestamp1), timestamp1);
           let hp = "0";
let hpRow = null;

if (body === "Venus" || body === "Mars") {
  const hpRows = await loadAlmanacCsv("venus-mars-hp.csv");
  hpRow = findDailyRow(hpRows, dateString);

  if (body === "Venus") {
    hp = hpRow?.venus_HP || hpRow?._values?.[1] || "0";
  }

  if (body === "Mars") {
    hp = hpRow?.mars_HP || hpRow?._values?.[2] || "0";
  }
}
            return {
                gha0: row0[`${prefix}_GHA`],
                gha1: row1[`${prefix}_GHA`],
                dec0: row0[`${prefix}_DECL`],
                dec1: row1[`${prefix}_DECL`],
                sha: "",
                sd: "0",
                hp: hp
            };
        }
        const planetRows = await loadAlmanacCsv ("planets.csv");
        const starRows = await loadAlmanacCsv("stars.csv");
        const aries0 = requireRow(findRowByTimestamp(planetRows, timestamp0), timestamp0);
        const aries1 = requireRow(findRowByTimestamp(planetRows, timestamp1), timestamp1);
        const starRow0 = requireRow (findDailyRow(starRows, dateString, (row) => normalizeName(row.Name) === normalizeName(body)), `${body} o ${dateString}`);
        return {
            gha0: aries0.aries_GHA,
            gha1: aries1.aries_GHA,
            dec0: starRow0.DECL,
            dec1: starRow0.DECL,
            sha: starRow0.SHA,
            sd: "0",
            hp: "0"
        };
    }
    function applyAlmanacValues(values) {
        setInputValue("#gha0", values.gha0);
        setInputValue("#gha1", values.gha1);
        setInputValue("#dec0", values.dec0);
        setInputValue("#dec1", values.dec1);
        setInputValue("#sha", values.sha);
        setInputValue("#sd", values.sd);
        setInputValue("#hp", values.hp);
    }
    async function handleFillFromAlmanac() {
        const body = getInputValue("#body-name");
        const datetimeValue = getInputValue("#datetime-utc");
        const datetime= parseUtcDateTimeInput(datetimeValue);
      
        if (!body || !datetime || Number.isNaN(datetime.getTime())) {
            alert ("Proszę wybrać nazwę ciała niebieskiego i datę/czas UTC");
            return;
        }
        const originalText = elements.fillFromAlmanac?.textContent;
        try {
            if (elements.fillFromAlmanac) {
                elements.fillFromAlmanac.textContent = "Ładowanie...";
                elements.fillFromAlmanac.disabled = true;
            }
            const values = await getAlmanacValues(body, datetime);
            applyAlmanacValues(values);
            if (elements.fillFromAlmanac) {
                elements.fillFromAlmanac.textContent = "Uzupełniono z almanachu";
            }
         window.setTimeout(() => {
            if (elements.fillFromAlmanac) {
                elements.fillFromAlmanac.textContent = originalText;
            }
        }, 1200);
    } catch (error) {
            alert(error.message);
        } finally {
            if (elements.fillFromAlmanac) {
                elements.fillFromAlmanac.disabled = false;
            }
        }
    }   

    function getObservationFormData() {
        const datetimeValue = getInputValue("#datetime-utc");
        const datetime = parseUtcDateTimeInput(datetimeValue);
        return {
                id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            body: getInputValue("#body-name"),
            datetimeUtc: datetimeValue, 
            datetimeIso: datetime ? datetime.toISOString() : "",
            hs: getInputValue("#hs"),
            gha0: getInputValue("#gha0"),
            gha1: getInputValue("#gha1"),
            dec0: getInputValue("#dec0"),
            dec1: getInputValue("#dec1"),
            sha: getInputValue("#sha"),
            limb: getInputValue("#limb"),
            sd: getInputValue("#sd"),
            hp: getInputValue("#hp"),
            artificialHorizon: Boolean(document.querySelector("#artificial-horizon")?.checked),computed:
            {
                ho: null,
                hc: null,
                zn: null,
                intercept: null
            }
        };
    }
    function formatOptionalNumber(value, decimals = 2, suffix = "") {
        if (!Number.isFinite(value)) {
            return "-";
        }
        return `${value.toFixed(decimals)}${suffix}`;
    }
    function getBodyLabel (body) {
        const label = {
            Sun: "Słońce",
            Moon: "Księżyc",
            Venus: "Wenus",
            Mars: "Mars",
            Jupiter: "Jowisz",
            Saturn: "Saturn",
            Sirius: "Syriusz",
            Canopus: "Kanopus",
            Arcturus: "Arktur",
            Vega: "Wega",
            Capella: "Kapella",
            Rigel: "Rigel",
            Procyon: "Procyon",
            Betelgeuse: "Betelgeza",
            Achernar: "Achernar",
            Aldebaran: "Aldebaran",
            Antares: "Antares",
            Pollux: "Polluks",
            Fomalhaut: "Fomalhaut",
            Deneb: "Deneb",
            Altair: "Altair",
            Spica: "Spika",
            Regulus: "Regulus",

        };
        return label[body] || body;
    }
        function updateResultCount() 
        {
            if (elements.resultCount) {
                elements.resultCount.textContent = String(observations.length);
            }
        }
       function renderObservationsTable() {
  if (!elements.observationsTable) {
    return;
  }

  if (observations.length === 0) {
    elements.observationsTable.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">Brak dodanych obserwacji.</td>
      </tr>
    `;
    updateResultCount();
    return;
  }

  const rowsHtml = observations.map((observation, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${getBodyLabel(observation.body)}</td>
      <td>${observation.datetimeUtc.replace("T", " ")}</td>
      <td>${observation.hs || "-"}</td>
      <td>${formatOptionalNumber(observation.computed.ho, 2, "°")}</td>
      <td>${formatOptionalNumber(observation.computed.hc, 2, "°")}</td>
      <td>${formatOptionalNumber(observation.computed.zn, 1, "°")}</td>
      <td>${formatOptionalNumber(observation.computed.intercept, 2, " NM")}</td>
      <td>
        <button class="table-button" type="button" data-remove-observation="${observation.id}">
          Usuń
        </button>
      </td>
    </tr>
  `).join("");

  elements.observationsTable.innerHTML = rowsHtml;
  updateResultCount();
}
    function addObservation(observation) {
        observations.push(observation);
       renderObservationsTable();
  
}
    
    function removeObservation(id) {
        const index  = observations.findIndex ((observation) => observation.id === id);
        if (index === -1) {
            return;
        }
        observations.splice(index, 1);
        renderObservationsTable();
    }
    function clearObservations() {
        observations.splice (0, observations. length);
        renderObservationsTable();
        if (elements.resultLat) {
            elements.resultLat.textContent = "-";
        }
        if (elements.resultLon) {
            elements.resultLon.textContent = "-";
        }
    }
function handleObservationSubmit(event) {
  event.preventDefault();

  const observation = getObservationFormData();
  

  addObservation(observation);

  elements.observationForm.reset();
  setDefaultUtcDateTime();
}
function handleTableClick(event){
    const removeButton = event.target.closest("[data-remove-observation]");

    if (!removeButton) {
        return;
    }
    removeObservation(removeButton.dataset.removeObservation);
}
function loadSessions() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        return [];
    }
}
function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
function renderSavedSessions() {
    if (!elements.savedSessions) {
        return;
    }

const sessions = loadSessions();

if (sessions.length === 0) {
    elements.savedSessions.innerHTML = `<option value="">Brak zapisanych sesji</option>`;
    return;
}
elements.savedSessions.innerHTML = sessions
.map((session) => {
    return `<option value="${session.id}">${session.name}</option>`;
})
.join("");
}
function handleSaveSession() {
    const sessions = loadSessions();
    const name = elements.sessionName?.value.trim() || `Sesja ${new Date().toLocaleString("pl-PL")}`;

    sessions.push({
        id:crypto.randomUUID(),
        name,
        createdAt: new Date().toISOString(),
        deadReckoning: getDeadReckoningData(),
        observations
    });
    saveSessions(sessions);
    renderSavedSessions();
    alert("Sesja została zapisana");
}
function handleLoadSession() {
    const sessionId=elements.savedSessions?.value;
    const session = loadSessions().find((item) => item.id === sessionId);
    if(!session) {
        alert("Wybierz zapisaną sesję.");
        return;
    }
    setDeadReckoningData(session.deadReckoning || {});
    observations.splice(0, observations.length, ...(session.observations || []));
    renderObservationsTable();

    if (elements.sessionName){
        elements.sessionName.value = session.name;
    }
}
function handleCalculateFix() {
  try {
    const deadReckoning = getDeadReckoningData();
    const result = window.CelestialCalculations.calculateFix(deadReckoning, observations);

    observations.splice(0, observations.length, ...result.observations);
    renderObservationsTable();

    if (elements.resultLat) {
  elements.resultLat.textContent = window.CelestialCalculations.formatCoordinate(
    result.latitude,
    "lat"
  );
}

if (elements.resultLon) {
  elements.resultLon.textContent = window.CelestialCalculations.formatCoordinate(
    result.longitude,
    "lon"
  );
}
  } catch (error) {
    alert(error.message);
  }
}
function bindEvents() {
    elements.setCurrentUtc?.addEventListener("click", setCurrentUtcDateTime);
    elements.observationForm?.addEventListener("submit", handleObservationSubmit);
    elements.observationsTable?.addEventListener("click", handleTableClick);
    elements.clearObservations?.addEventListener("click", clearObservations);
    elements.calculateFix?.addEventListener("click", handleCalculateFix);
    elements.fillFromAlmanac?.addEventListener("click", handleFillFromAlmanac);
    elements.saveSession?.addEventListener("click", handleSaveSession);
    elements.loadSession?.addEventListener("click",handleLoadSession);
}
function init() {
    setCurrentUtcDateTime();
    bindEvents();
    renderObservationsTable();
    renderSavedSessions();
}
init ();
