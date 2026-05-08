(function() {
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;
    function degToRad(value) {
        return value * DEG_TO_RAD;
    }

    function radToDeg(value) {
        return value * RAD_TO_DEG;
    }

    function normalize360(value){
        return ((value % 360)+ 360) % 360;
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }
    
    function parseAngle(value) {
        const cleaned = String(value ?? "")
        .trim()
        .replace(/,/g, ".")
        .replace(/[°'′'"]/g, ":")
        .replace(/:+$/g, "");

        if (!cleaned) {
            return 0;
        }
    

    const parts = cleaned.split(":").map((part) => Number(part));
    
    if (parts.some((part) => Number.isNaN(part))) {
        throw new Error(`Nieprawidłowy format kąta: ${value}`);
    }

    const sign = cleaned.startsWith("-") ? -1 : 1;
    const degrees = Math.abs(parts[0] || 0);
    const minutes = Math.abs(parts[1] || 0);
    const seconds = Math.abs(parts[2] || 0);

    return sign * (degrees + minutes / 60 + seconds / 3600);
}

    function parseArcMinutes(value) {
    const text = String(value ?? "").trim();

    if (!text) {
      return 0;
    }

    if (/[:°"]/.test(text)) {
      return parseAngle(text) * 60;
    }

    const number = Number(text.replace(/['′]/g, "").replace(/,/g, "."));
    return Number.isFinite(number) ? number : 0;
  }

  function getObservationHourFraction(datetimeIso) {
    const date = new Date(datetimeIso);

    if (Number.isNaN(date.getTime())) {
      throw new Error("Nieprawidłowa data obserwacji.");
    }

    const minutes = date.getUTCMinutes();
    const seconds = date.getUTCSeconds();
    const milliseconds = date.getUTCMilliseconds();

    return (minutes * 60 + seconds + milliseconds / 1000) / 3600;
  }

  function interpolateLinear(start, end, fraction) {
    return start + (end - start) * fraction;
  }

  function interpolateGha(gha0, gha1, fraction) {
    let start = parseAngle(gha0);
    let end = parseAngle(gha1);

    if (end < start) {
      end += 360;
    }

    return normalize360(interpolateLinear(start, end, fraction));
  }

  function interpolateDeclination(dec0, dec1, fraction) {
    return interpolateLinear(parseAngle(dec0), parseAngle(dec1), fraction);
  }

  function getRefractionMinutes(altitudeDegrees, temperatureCelsius, pressureHpa) {
    const altitude = Math.max(altitudeDegrees, 0.1);
    const pressureFactor = pressureHpa / 1010;
    const temperatureFactor = 283 / (273 + temperatureCelsius);
    const bennettArgument = altitude + 7.31 / (altitude + 4.4);
    const refraction = 1 / Math.tan(degToRad(bennettArgument));

    return refraction * pressureFactor * temperatureFactor;
  }

  function getDipMinutes(eyeHeightMeters) {
    const height = Math.max(Number(eyeHeightMeters) || 0, 0);
    return 1.76 * Math.sqrt(height);
  }

  function correctObservedAltitude(observation, deadReckoning) {
    let altitude = parseAngle(observation.hs);

    if (observation.correctedAltitude) {
      return altitude;
    }

    altitude += (Number(deadReckoning.indexError) || 0) / 60;

    if (observation.artificialHorizon) {
      altitude /= 2;
    }

    const dipMinutes = observation.artificialHorizon
      ? 0
      : getDipMinutes(deadReckoning.eyeHeight);

    const refractionMinutes = getRefractionMinutes(
      altitude,
      Number(deadReckoning.temperature) || 10,
      Number(deadReckoning.pressure) || 1010
    );

    const sdMinutes = parseArcMinutes(observation.sd);
    const hpMinutes = parseArcMinutes(observation.hp);

    let limbCorrectionMinutes = 0;

    if (observation.limb === "lower") {
      limbCorrectionMinutes = sdMinutes;
    }

    if (observation.limb === "upper") {
      limbCorrectionMinutes = -sdMinutes;
    }

    const parallaxMinutes = hpMinutes * Math.cos(degToRad(altitude));

    return altitude
      - dipMinutes / 60
      - refractionMinutes / 60
      + limbCorrectionMinutes / 60
      + parallaxMinutes / 60;
  }

  function getBodyGhaAndDeclination(observation) {
    const fraction = getObservationHourFraction(observation.datetimeIso);
    let gha = interpolateGha(observation.gha0, observation.gha1, fraction);
    const declination = interpolateDeclination(observation.dec0, observation.dec1, fraction);

    if (observation.sha) {
      gha = normalize360(gha + parseAngle(observation.sha));
    }

    return {
      gha,
      declination
    };
  }

  function calculateComputedAltitudeAndAzimuth(observation, deadReckoning) {
    const latitude = parseAngle(deadReckoning.lat);
    const longitude = parseAngle(deadReckoning.lon);
    const { gha, declination } = getBodyGhaAndDeclination(observation);

    const latRad = degToRad(latitude);
    const decRad = degToRad(declination);
    const lha = normalize360(gha + longitude);
    const lhaRad = degToRad(lha);

    const sinHc =
      Math.sin(latRad) * Math.sin(decRad) +
      Math.cos(latRad) * Math.cos(decRad) * Math.cos(lhaRad);

    const hcRad = Math.asin(clamp(sinHc, -1, 1));
    const hc = radToDeg(hcRad);

    const cosHc = Math.cos(hcRad);
    const sinZn = -Math.cos(decRad) * Math.sin(lhaRad) / cosHc;
    const cosZn =
      (Math.sin(decRad) - Math.sin(latRad) * Math.sin(hcRad)) /
      (Math.cos(latRad) * cosHc);

    const zn = normalize360(radToDeg(Math.atan2(sinZn, cosZn)));

    return {
      gha,
      declination,
      lha,
      hc,
      zn
    };
  }

  function calculateObservation(observation, deadReckoning) {
    const ho = correctObservedAltitude(observation, deadReckoning);
    const computed = calculateComputedAltitudeAndAzimuth(observation, deadReckoning);
    const intercept = 60 * (ho - computed.hc);

    return {
      ...observation,
      computed: {
        ho,
        hc: computed.hc,
        zn: computed.zn,
        intercept,
        gha: computed.gha,
        declination: computed.declination,
        lha: computed.lha
      }
    };
  }

  function parseUtcDateTime(value) {
    const text = String(value ?? "").trim();

    if (!text) {
      return null;
    }

    let normalized = text;

    if (normalized.includes(" ") && !normalized.includes("T")) {
      normalized = normalized.replace(" ", "T");
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      normalized = `${normalized}T00:00:00`;
    }

    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
      normalized = `${normalized}:00`;
    }

    const date = normalized.endsWith("Z")
      ? new Date(normalized)
      : new Date(`${normalized}Z`);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getMotionReferenceDate(deadReckoning, observations) {
    if (!deadReckoning.motion?.enabled) {
      return null;
    }

    const configuredDate = parseUtcDateTime(deadReckoning.motion.referenceTime);

    if (configuredDate) {
      return configuredDate;
    }

    const observationDates = observations
      .map((observation) => parseUtcDateTime(observation.datetimeIso || observation.datetimeUtc))
      .filter(Boolean)
      .sort((a, b) => b.getTime() - a.getTime());

    if (observationDates.length === 0) {
      throw new Error("Nie można uwzględnić ruchu statku bez czasu obserwacji.");
    }

    return observationDates[0];
  }

  function getDeadReckoningForObservation(deadReckoning, observation, referenceDate) {
    if (!deadReckoning.motion?.enabled) {
      return {
        ...deadReckoning,
        motionOffsetEastNm: 0,
        motionOffsetNorthNm: 0,
        motionTimeOffsetHours: 0
      };
    }

    const observationDate = parseUtcDateTime(observation.datetimeIso || observation.datetimeUtc);

    if (!observationDate || !referenceDate) {
      throw new Error("Nie można uwzględnić ruchu statku bez poprawnego czasu obserwacji i czasu odniesienia.");
    }

    const speed = Number(deadReckoning.motion.speed);
    const course = Number(deadReckoning.motion.course);

    if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(course)) {
      throw new Error("Podaj poprawny kurs COG i prędkość SOG dla ruchu statku.");
    }

    const baseLat = Number(deadReckoning.lat);
    const baseLon = Number(deadReckoning.lon);
    const timeOffsetHours = (observationDate.getTime() - referenceDate.getTime()) / 3600000;
    const distanceNm = speed * timeOffsetHours;
    const courseRad = degToRad(normalize360(course));
    const northNm = distanceNm * Math.cos(courseRad);
    const eastNm = distanceNm * Math.sin(courseRad);
    const latitude = baseLat + northNm / 60;
    const cosLatitude = Math.cos(degToRad(baseLat));

    if (Math.abs(cosLatitude) < 1e-8) {
      throw new Error("Nie można uwzględnić ruchu statku tak blisko bieguna.");
    }

    const longitude = baseLon + eastNm / (60 * cosLatitude);

    return {
      ...deadReckoning,
      lat: latitude,
      lon: longitude,
      motionOffsetEastNm: eastNm,
      motionOffsetNorthNm: northNm,
      motionTimeOffsetHours: timeOffsetHours
    };
  }

  function calculateFix(deadReckoning, observations) {
    if (observations.length < 2) {
      throw new Error("Do wyznaczenia pozycji potrzebne są co najmniej dwie obserwacje.");
    }

    const referenceDate = getMotionReferenceDate(deadReckoning, observations);
    const computedObservations = observations.map((observation) => {
      const observationDeadReckoning = getDeadReckoningForObservation(
        deadReckoning,
        observation,
        referenceDate
      );
      const computedObservation = calculateObservation(observation, observationDeadReckoning);

      return {
        ...computedObservation,
        computed: {
          ...computedObservation.computed,
          drLat: observationDeadReckoning.lat,
          drLon: observationDeadReckoning.lon,
          motionOffsetEastNm: observationDeadReckoning.motionOffsetEastNm,
          motionOffsetNorthNm: observationDeadReckoning.motionOffsetNorthNm,
          motionTimeOffsetHours: observationDeadReckoning.motionTimeOffsetHours
        }
      };
    });

    let sss = 0;
    let scc = 0;
    let ssc = 0;
    let ssb = 0;
    let scb = 0;

    computedObservations.forEach((observation) => {
      const azimuthRad = degToRad(observation.computed.zn);
      const s = Math.sin(azimuthRad);
      const c = Math.cos(azimuthRad);
      const b = observation.computed.intercept;

      sss += s * s;
      scc += c * c;
      ssc += s * c;
      ssb += s * b;
      scb += c * b;
    });

    const determinant = sss * scc - ssc * ssc;

    if (Math.abs(determinant) < 1e-9) {
      throw new Error("Nie można wyznaczyć pozycji. Linie pozycyjne są zbyt równoległe.");
    }

    const eastNm = (scc * ssb - ssc * scb) / determinant;
    const northNm = (-ssc * ssb + sss * scb) / determinant;

    const drLat = Number(deadReckoning.lat);
    const drLon = Number(deadReckoning.lon);
    const latitude = drLat + northNm / 60;
    const longitude = drLon + eastNm / (60 * Math.cos(degToRad(drLat)));

    if (Math.abs(latitude) > 90) {
  throw new Error("Wynik szerokości geograficznej jest poza zakresem. Sprawdź dane obserwacji, pozycję DR oraz znaki długości geograficznej.");
}

    return {
      latitude,
      longitude,
      eastNm,
      northNm,
      observations: computedObservations
    };
  }
  function formatCoordinate(value, type) {
  const isLatitude = type === "lat";
  const direction = isLatitude
    ? value >= 0 ? "N" : "S"
    : value >= 0 ? "E" : "W";

  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;
  const formattedMinutes = minutes.toFixed(2).replace(".", ",");

  return `${direction} ${degrees}° ${formattedMinutes}′`;
}

  window.CelestialCalculations = {
    parseAngle,
    parseArcMinutes,
    calculateObservation,
    calculateFix,
    formatCoordinate
  };
})();
