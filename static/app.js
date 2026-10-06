const uploadInput = document.getElementById('videoInput');
const originalVideo = document.getElementById('originalVideo');
const processedVideo = document.getElementById('processedVideo');
const detectionStatus = document.getElementById('detectionStatus');
const ambulanceCount = document.getElementById('ambulanceCount');
const confidenceValue = document.getElementById('confidenceValue');
const directionValue = document.getElementById('directionValue');
const systemState = document.getElementById('systemState');
const emergencyBanner = document.getElementById('emergencyBanner');
const emergencySummary = document.getElementById('emergencySummary');
const detectionTime = document.getElementById('detectionTime');
const signalStateText = document.getElementById('signalStateText');
const emergencyModeText = document.getElementById('emergencyModeText');
const signalCountdown = document.getElementById('signalCountdown');
const congestionList = document.getElementById('congestionList');
const hospitalName = document.getElementById('hospitalName');
const routeDistance = document.getElementById('routeDistance');
const routeEta = document.getElementById('routeEta');
const hospitalOptions = document.getElementById('hospitalOptions');
const liveStatus = document.getElementById('liveStatus');
const liveDirection = document.getElementById('liveDirection');
const liveSpeed = document.getElementById('liveSpeed');
const liveProgress = document.getElementById('liveProgress');
const liveEta = document.getElementById('liveEta');
const ambulanceMarker = document.getElementById('ambulanceMarker');
const greenCorridor = document.getElementById('greenCorridor');
const dispatchButton = document.getElementById('dispatchButton');
const stopSimulationButton = document.getElementById('stopSimulationButton');
const resetSimulationButton = document.getElementById('resetSimulationButton');
const currentJunction = document.getElementById('currentJunction');
const nextJunction = document.getElementById('nextJunction');
const distanceRemaining = document.getElementById('distanceRemaining');
const distanceToNextElement = document.getElementById('distanceToNext');
const routePriorityStatus = document.getElementById('routePriorityStatus');
const liveLog = document.getElementById('liveLog');

const laneNames = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
const EMERGENCY_PRIORITY_MS = 30_000;
const NORMAL_SIGNAL_DURATION_MS = 60_000;
const AMBULANCE_SPEED_KMH = 40;
const GEOFENCE_THRESHOLD_M = 100;
const TELEMETRY_UPDATE_MS = 350;
const baseCongestion = { NORTH: 72, SOUTH: 31, EAST: 84, WEST: 45 };
const routePoints = [
  { name: 'START', x: 60, y: 70, metersFromPrevious: 0 },
  { name: 'Junction 1 · Metro North', x: 230, y: 70, metersFromPrevious: 280, junction: true },
  { name: 'Junction 2 · Central Ave', x: 500, y: 70, metersFromPrevious: 300, junction: true },
  { name: 'Junction 3 · Broadway', x: 500, y: 220, metersFromPrevious: 350, junction: true },
  { name: 'Junction 4 · Hospital Way', x: 500, y: 370, metersFromPrevious: 280, junction: true },
  { name: 'City General Hospital', x: 800, y: 370, metersFromPrevious: 360, hospital: true },
];
let routeDistanceM = 0;
routePoints.forEach((point, index) => {
  if (index > 0) {
    point.distanceFromStart = routePoints[index - 1].distanceFromStart + point.metersFromPrevious;
  } else {
    point.distanceFromStart = 0;
  }
  routeDistanceM = point.distanceFromStart;
});
const routeTrip = {
  status: 'idle',
  distanceTravelledM: 0,
  lastFrameTime: 0,
  lastTelemetryTime: 0,
  priorityJunctionIndex: null,
  crossedJunctions: new Set(),
  animationFrameId: null,
};
const hospitals = [
  { name: 'City General Trauma Center', distance: 5.6, eta: 13 },
  { name: 'Northside Emergency Hospital', distance: 7.2, eta: 18 },
  { name: 'Riverside Medical Unit', distance: 4.1, eta: 11 },
  { name: 'Central Community Health', distance: 8.8, eta: 22 },
];

const trafficState = {
  signalState: {
    NORTH: 'RED',
    SOUTH: 'RED',
    EAST: 'RED',
    WEST: 'RED',
  },
  emergencyMode: false,
  activeDirection: 'NORTH',
  emergencyEndsAt: null,
  normalPhaseIndex: 0,
  normalPhaseEndsAt: Date.now() + NORMAL_SIGNAL_DURATION_MS,
};

function levelLabel(value) {
  if (value < 35) return 'Low';
  if (value < 60) return 'Medium';
  if (value < 80) return 'High';
  return 'Severe';
}

function updateCongestion() {
  const rows = Object.entries(baseCongestion).map(([direction, value]) => {
    const level = levelLabel(value);
    const fillWidth = Math.min(value, 100);
    return `
      <div class="congestion-row">
        <strong>${direction}</strong>
        <div class="bar-wrap">
          <div class="bar-fill" style="width:${fillWidth}%"></div>
        </div>
        <span class="level-pill ${level.toLowerCase()}">${level}</span>
      </div>
    `;
  });

  congestionList.innerHTML = rows.join('');
}

function updateMapJunctionSignals() {
  document.querySelectorAll('.map-junction').forEach((junction) => {
    const routeIndex = Number(junction.dataset.junction);
    const direction = directionForSegment(routePoints[routeIndex - 1], routePoints[routeIndex]);
    junction.classList.toggle(
      'normal-green',
      !trafficState.emergencyMode && trafficState.signalState[direction] === 'GREEN',
    );
  });
}

function updateSignalLights() {
  laneNames.forEach((lane) => {
    const card = document.querySelector(`.direction[data-direction="${lane}"]`);
    if (!card) return;

    const lights = card.querySelectorAll('.light');
    lights.forEach((light) => {
      const state = light.classList.contains('red') ? 'RED' : light.classList.contains('yellow') ? 'YELLOW' : 'GREEN';
      light.classList.toggle('active', trafficState.signalState[lane] === state);
    });
  });
  updateMapJunctionSignals();
}

function setNormalSignalPhase() {
  const direction = laneNames[trafficState.normalPhaseIndex];
  trafficState.signalState = {
    NORTH: direction === 'NORTH' ? 'GREEN' : 'RED',
    SOUTH: direction === 'SOUTH' ? 'GREEN' : 'RED',
    EAST: direction === 'EAST' ? 'GREEN' : 'RED',
    WEST: direction === 'WEST' ? 'GREEN' : 'RED',
  };
  trafficState.activeDirection = direction;
  signalStateText.textContent = `${direction} GREEN`;
  updateSignalLights();
}

function activateEmergency(direction) {
  trafficState.emergencyMode = true;
  trafficState.activeDirection = direction;
  trafficState.emergencyEndsAt = Date.now() + EMERGENCY_PRIORITY_MS;

  laneNames.forEach((lane) => {
    trafficState.signalState[lane] = lane === direction ? 'GREEN' : 'RED';
  });

  systemState.textContent = 'EMERGENCY MODE';
  systemState.style.background = 'rgba(255, 90, 95, 0.18)';
  systemState.style.color = '#ffd7d9';
  emergencyBanner.style.display = 'flex';
  emergencySummary.textContent = `${direction} lane → GREEN`;
  signalStateText.textContent = `${direction} priority`;
  emergencyModeText.textContent = 'ON';
  signalCountdown.textContent = '30s';
  updateSignalLights();
}

function restoreNormalMode() {
  trafficState.emergencyMode = false;
  trafficState.emergencyEndsAt = null;
  trafficState.normalPhaseIndex = 0;
  trafficState.normalPhaseEndsAt = Date.now() + NORMAL_SIGNAL_DURATION_MS;

  systemState.textContent = 'NORMAL MODE';
  systemState.style.background = 'rgba(71, 217, 133, 0.12)';
  systemState.style.color = '#72f5d1';
  emergencyBanner.style.display = 'none';
  emergencyModeText.textContent = 'OFF';
  setNormalSignalPhase();
  signalCountdown.textContent = '60s';
}

function updateTrafficSignalTimer() {
  const now = Date.now();

  if (trafficState.emergencyMode && trafficState.emergencyEndsAt === null) {
    return;
  }

  if (trafficState.emergencyMode && trafficState.emergencyEndsAt !== null) {
    const remainingMs = trafficState.emergencyEndsAt - now;
    if (remainingMs <= 0) {
      trafficState.emergencyMode = false;
      trafficState.emergencyEndsAt = null;
      trafficState.normalPhaseIndex = (laneNames.indexOf(trafficState.activeDirection) + 1) % laneNames.length;
      trafficState.normalPhaseEndsAt = now + NORMAL_SIGNAL_DURATION_MS;
      systemState.textContent = 'NORMAL MODE';
      systemState.style.background = 'rgba(71, 217, 133, 0.12)';
      systemState.style.color = '#72f5d1';
      emergencyBanner.style.display = 'none';
      emergencyModeText.textContent = 'OFF';
      setNormalSignalPhase();
      signalCountdown.textContent = '60s';
      return;
    }

    signalCountdown.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    return;
  }

  if (now >= trafficState.normalPhaseEndsAt) {
    trafficState.normalPhaseIndex = (trafficState.normalPhaseIndex + 1) % laneNames.length;
    trafficState.normalPhaseEndsAt = now + NORMAL_SIGNAL_DURATION_MS;
    setNormalSignalPhase();
  }

  signalCountdown.textContent = `${Math.max(0, Math.ceil((trafficState.normalPhaseEndsAt - now) / 1000))}s`;
}

function renderHospitals(selectedName) {
  hospitalOptions.innerHTML = hospitals
    .map((hospital) => {
      const isActive = hospital.name === selectedName;
      return `
        <div class="hospital-card ${isActive ? 'active' : ''}" data-hospital="${hospital.name}">
          <div>
            <strong>${hospital.name}</strong>
            <small>${hospital.distance} km • ${hospital.eta} min</small>
          </div>
          <span class="level-pill ${hospital.eta < 14 ? 'low' : hospital.eta < 20 ? 'medium' : 'high'}">${hospital.eta < 14 ? 'Fast' : hospital.eta < 20 ? 'Stable' : 'Busy'}</span>
        </div>
      `;
    })
    .join('');

  hospitalOptions.querySelectorAll('.hospital-card').forEach((card) => {
    card.addEventListener('click', () => {
      const chosen = card.dataset.hospital;
      const hospital = hospitals.find((item) => item.name === chosen);
      if (!hospital) return;

      hospitalName.textContent = hospital.name;
      routeDistance.textContent = `${hospital.distance.toFixed(1)} km`;
      routeEta.textContent = `${hospital.eta} min`;
      renderHospitals(hospital.name);
    });
  });
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function addLiveLog(message) {
  const entry = document.createElement('div');
  entry.className = 'live-log-entry';
  entry.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  liveLog.prepend(entry);
  while (liveLog.children.length > 12) {
    liveLog.lastElementChild.remove();
  }
}

function directionForSegment(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'EAST' : 'WEST';
  return dy >= 0 ? 'SOUTH' : 'NORTH';
}

function positionAtDistance(distanceM) {
  const currentDistance = Math.min(routeDistanceM, Math.max(0, distanceM));
  let nextIndex = routePoints.findIndex((point, index) => index > 0 && point.distanceFromStart >= currentDistance);
  if (nextIndex < 1) nextIndex = routePoints.length - 1;

  const from = routePoints[nextIndex - 1];
  const to = routePoints[nextIndex];
  const segmentDistance = to.distanceFromStart - from.distanceFromStart;
  const fraction = segmentDistance === 0 ? 1 : (currentDistance - from.distanceFromStart) / segmentDistance;
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    segmentIndex: nextIndex - 1,
  };
}

function updateMapMarker() {
  const position = positionAtDistance(routeTrip.distanceTravelledM);
  ambulanceMarker.setAttribute('transform', `translate(${position.x} ${position.y})`);
  return position;
}

function setRouteSignalsNormal() {
  document.querySelectorAll('.map-junction').forEach((junction) => {
    junction.classList.remove('priority-active');
  });
  greenCorridor.setAttribute('d', '');
  routePriorityStatus.textContent = 'OFF';
  if (trafficState.emergencyMode && trafficState.emergencyEndsAt === null) {
    trafficState.normalPhaseIndex = (laneNames.indexOf(trafficState.activeDirection) + 1) % laneNames.length;
    trafficState.normalPhaseEndsAt = Date.now() + NORMAL_SIGNAL_DURATION_MS;
    trafficState.emergencyMode = false;
    trafficState.emergencyEndsAt = null;
    setNormalSignalPhase();
    systemState.textContent = 'NORMAL MODE';
    systemState.style.background = 'rgba(71, 217, 133, 0.12)';
    systemState.style.color = '#72f5d1';
    emergencyBanner.style.display = 'none';
    emergencyModeText.textContent = 'OFF';
    signalCountdown.textContent = `${Math.ceil(NORMAL_SIGNAL_DURATION_MS / 1000)}s`;
  }
}

function buildCorridorPath(position, junctionIndex) {
  const points = [position];
  for (let index = position.segmentIndex + 1; index <= junctionIndex; index += 1) {
    points.push(routePoints[index]);
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function setRoutePriority(junctionIndex, position) {
  if (routeTrip.priorityJunctionIndex === junctionIndex) {
    greenCorridor.setAttribute('d', buildCorridorPath(position, junctionIndex));
    return;
  }

  if (routeTrip.priorityJunctionIndex !== null) {
    const previous = routePoints[routeTrip.priorityJunctionIndex];
    document.querySelector(`.map-junction[data-junction="${routeTrip.priorityJunctionIndex}"]`)?.classList.remove('priority-active');
    addLiveLog(`${previous.name} priority released`);
  }

  routeTrip.priorityJunctionIndex = junctionIndex;
  const junction = routePoints[junctionIndex];
  const from = routePoints[junctionIndex - 1];
  const direction = directionForSegment(from, junction);
  trafficState.emergencyMode = true;
  trafficState.emergencyEndsAt = null;
  trafficState.activeDirection = direction;
  trafficState.signalState = Object.fromEntries(laneNames.map((lane) => [lane, lane === direction ? 'GREEN' : 'RED']));
  updateSignalLights();

  document.querySelector(`.map-junction[data-junction="${junctionIndex}"]`)?.classList.add('priority-active');
  greenCorridor.setAttribute('d', buildCorridorPath(position, junctionIndex));
  systemState.textContent = 'EMERGENCY MODE';
  systemState.style.background = 'rgba(255, 90, 95, 0.18)';
  systemState.style.color = '#ffd7d9';
  emergencyBanner.style.display = 'flex';
  emergencySummary.textContent = `${junction.name} · ${direction} → GREEN`;
  signalStateText.textContent = `${direction} priority`;
  emergencyModeText.textContent = 'ON';
  signalCountdown.textContent = 'APPROACHING';
  routePriorityStatus.textContent = `J${junctionIndex} · ${direction}`;
  liveStatus.textContent = `Priority active · ${junction.name}`;
  addLiveLog(`${junction.name}: ${direction} GREEN priority activated`);
}

function updateJunctionPriority(position) {
  routePoints.forEach((point, index) => {
    if (!point.junction || routeTrip.crossedJunctions.has(index)) return;
    if (routeTrip.distanceTravelledM >= point.distanceFromStart) {
      routeTrip.crossedJunctions.add(index);
      if (routeTrip.priorityJunctionIndex === index) {
        document.querySelector(`.map-junction[data-junction="${index}"]`)?.classList.remove('priority-active');
        routeTrip.priorityJunctionIndex = null;
        addLiveLog(`${point.name} crossed · priority released`);
        setRouteSignalsNormal();
      }
    }
  });

  const approachingIndex = routePoints.findIndex((point, index) =>
    point.junction
    && !routeTrip.crossedJunctions.has(index)
    && point.distanceFromStart - routeTrip.distanceTravelledM <= GEOFENCE_THRESHOLD_M
  );

  if (approachingIndex > 0) {
    setRoutePriority(approachingIndex, position);
  } else if (routeTrip.priorityJunctionIndex !== null) {
    routeTrip.priorityJunctionIndex = null;
    setRouteSignalsNormal();
  }
}

function updateTripTelemetry(position) {
  const currentRoutePointIndex = routePoints.reduce((lastIndex, point, index) =>
    point.junction && routeTrip.crossedJunctions.has(index) ? index : lastIndex, 0);
  const nextPointIndex = routePoints.findIndex((point, index) => index > currentRoutePointIndex && point.junction && !routeTrip.crossedJunctions.has(index));
  const nextStopIndex = nextPointIndex === -1 ? routePoints.length - 1 : nextPointIndex;
  const nextStop = routePoints[nextStopIndex];
  const remainingM = Math.max(0, routeDistanceM - routeTrip.distanceTravelledM);
  const distanceToNext = Math.max(0, nextStop.distanceFromStart - routeTrip.distanceTravelledM);
  const speedMps = AMBULANCE_SPEED_KMH / 3.6;
  const progress = Math.min(100, (routeTrip.distanceTravelledM / routeDistanceM) * 100);
  const heading = routeTrip.status === 'running' ? directionForSegment(routePoints[position.segmentIndex], routePoints[position.segmentIndex + 1]) : '-';

  currentJunction.textContent = routePoints[currentRoutePointIndex].name;
  nextJunction.textContent = nextStop.junction ? nextStop.name : 'Hospital';
  distanceToNextElement.textContent = `${Math.round(distanceToNext).toLocaleString()} m`;
  document.getElementById('distanceRemaining').textContent = `${Math.round(remainingM).toLocaleString()} m`;
  liveSpeed.textContent = `${routeTrip.status === 'running' ? AMBULANCE_SPEED_KMH : 0} km/h`;
  liveProgress.textContent = `${progress.toFixed(1)}%`;
  liveEta.textContent = formatDuration(remainingM / speedMps);
  liveDirection.textContent = heading;
  if (routeTrip.status === 'idle') liveStatus.textContent = 'Ready to dispatch';
  if (routeTrip.status === 'paused') liveStatus.textContent = 'Simulation paused';
  if (routeTrip.status === 'arrived') liveStatus.textContent = 'AMBULANCE ARRIVED';
  if (routeTrip.status === 'running' && routeTrip.priorityJunctionIndex === null) liveStatus.textContent = `En route to ${nextJunction.textContent}`;
}

function finishTrip() {
  routeTrip.distanceTravelledM = routeDistanceM;
  routeTrip.status = 'arrived';
  routeTrip.animationFrameId = null;
  updateMapMarker();
  updateTripTelemetry(positionAtDistance(routeDistanceM));
  distanceRemaining.textContent = '0 m';
  liveProgress.textContent = '100%';
  liveEta.textContent = '0:00';
  liveSpeed.textContent = '0 km/h';
  liveStatus.textContent = 'AMBULANCE ARRIVED';
  detectionStatus.textContent = 'AMBULANCE ARRIVED';
  routePriorityStatus.textContent = 'OFF';
  setRouteSignalsNormal();
  routeTrip.priorityJunctionIndex = null;
  dispatchButton.disabled = false;
  stopSimulationButton.disabled = true;
  addLiveLog('AMB-001 arrived at City General Hospital · all priorities released');
}

function animateTrip(timestamp) {
  if (routeTrip.status !== 'running') return;
  if (!routeTrip.lastFrameTime) routeTrip.lastFrameTime = timestamp;
  const deltaSeconds = Math.min((timestamp - routeTrip.lastFrameTime) / 1000, 0.1);
  routeTrip.lastFrameTime = timestamp;
  routeTrip.distanceTravelledM = Math.min(
    routeDistanceM,
    routeTrip.distanceTravelledM + (AMBULANCE_SPEED_KMH / 3.6) * deltaSeconds,
  );

  const position = updateMapMarker();
  updateJunctionPriority(position);
  if (timestamp - routeTrip.lastTelemetryTime >= TELEMETRY_UPDATE_MS) {
    updateTripTelemetry(position);
    routeTrip.lastTelemetryTime = timestamp;
  }

  if (routeTrip.distanceTravelledM >= routeDistanceM) {
    finishTrip();
    return;
  }
  routeTrip.animationFrameId = requestAnimationFrame(animateTrip);
}

function startTrip() {
  if (routeTrip.status === 'running') return;
  if (routeTrip.status === 'paused') {
    routeTrip.status = 'running';
    routeTrip.lastFrameTime = 0;
    dispatchButton.disabled = true;
    stopSimulationButton.disabled = false;
    routeTrip.animationFrameId = requestAnimationFrame(animateTrip);
    addLiveLog('AMB-001 movement resumed');
    return;
  }

  resetTrip(false);
  routeTrip.status = 'running';
  trafficState.emergencyMode = false;
  restoreNormalMode();
  routeTrip.lastFrameTime = 0;
  dispatchButton.disabled = true;
  stopSimulationButton.disabled = false;
  detectionStatus.textContent = 'AMBULANCE EN ROUTE';
  addLiveLog('AMB-001 dispatched · route to City General Hospital');
  routeTrip.animationFrameId = requestAnimationFrame(animateTrip);
}

function stopTrip() {
  if (routeTrip.status !== 'running') return;
  routeTrip.status = 'paused';
  if (routeTrip.animationFrameId !== null) cancelAnimationFrame(routeTrip.animationFrameId);
  routeTrip.animationFrameId = null;
  routeTrip.priorityJunctionIndex = null;
  setRouteSignalsNormal();
  updateTripTelemetry(positionAtDistance(routeTrip.distanceTravelledM));
  dispatchButton.disabled = false;
  stopSimulationButton.disabled = true;
  detectionStatus.textContent = 'SIMULATION PAUSED';
  addLiveLog('AMB-001 movement stopped · junction priority released');
}

function resetTrip(writeLog = true) {
  if (routeTrip.animationFrameId !== null) cancelAnimationFrame(routeTrip.animationFrameId);
  routeTrip.status = 'idle';
  routeTrip.distanceTravelledM = 0;
  routeTrip.lastFrameTime = 0;
  routeTrip.lastTelemetryTime = 0;
  routeTrip.priorityJunctionIndex = null;
  routeTrip.crossedJunctions.clear();
  routeTrip.animationFrameId = null;
  setRouteSignalsNormal();
  restoreNormalMode();
  ambulanceMarker.setAttribute('transform', `translate(${routePoints[0].x} ${routePoints[0].y})`);
  greenCorridor.setAttribute('d', '');
  document.querySelectorAll('.map-junction').forEach((junction) => junction.classList.remove('priority-active'));
  updateTripTelemetry(positionAtDistance(0));
  routePriorityStatus.textContent = 'OFF';
  detectionStatus.textContent = 'Awaiting dispatch';
  dispatchButton.disabled = false;
  stopSimulationButton.disabled = true;
  if (writeLog) addLiveLog('Route reset · ambulance returned to START');
}

function setEvaluation(result) {
  const direction = result.direction || 'NORTH';
  detectionStatus.textContent = result.emergency_mode ? 'AMBULANCE DETECTED' : 'Tracking traffic';
  ambulanceCount.textContent = String(result.ambulance_count || 0);
  confidenceValue.textContent = `${result.confidence || 0}%`;
  directionValue.textContent = direction;
  detectionTime.textContent = result.detection_time || '--:--:--';

  if (result.emergency_mode) {
    activateEmergency(direction);
  } else {
    restoreNormalMode();
  }

  if (result.signal_state) {
    trafficState.signalState = result.signal_state;
    if (result.emergency_mode) {
      trafficState.signalState = {
        NORTH: direction === 'NORTH' ? 'GREEN' : 'RED',
        SOUTH: direction === 'SOUTH' ? 'GREEN' : 'RED',
        EAST: direction === 'EAST' ? 'GREEN' : 'RED',
        WEST: direction === 'WEST' ? 'GREEN' : 'RED',
      };
    }
    updateSignalLights();
  }

  if (result.route) {
    hospitalName.textContent = result.route.hospital || hospitalName.textContent;
    routeDistance.textContent = `${result.route.distance_km || 0} km`;
    routeEta.textContent = `${result.route.travel_time_min || 0} min`;
  }

  if (result.congestion) {
    Object.keys(result.congestion).forEach((lane) => {
      const value = result.congestion[lane];
      baseCongestion[lane] = value;
    });
    updateCongestion();
  }
}

uploadInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const videoUrl = URL.createObjectURL(file);
  originalVideo.src = videoUrl;
  processedVideo.src = videoUrl;
  originalVideo.load();
  processedVideo.load();

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Unable to process the video.');
    }

    const result = await response.json();
    setEvaluation(result);
  } catch (error) {
    detectionStatus.textContent = 'Analysis failed';
    confidenceValue.textContent = '0%';
    console.error(error);
  }
});

updateCongestion();
updateSignalLights();
renderHospitals('City General Trauma Center');
dispatchButton.addEventListener('click', startTrip);
stopSimulationButton.addEventListener('click', stopTrip);
resetSimulationButton.addEventListener('click', () => resetTrip());
resetTrip(false);

setInterval(() => {
  laneNames.forEach((lane) => {
    const next = Math.min(100, Math.max(20, baseCongestion[lane] + (Math.random() > 0.5 ? 1 : -1) * 2));
    baseCongestion[lane] = Math.round(next);
  });

  updateTrafficSignalTimer();
  updateCongestion();
}, 1000);
