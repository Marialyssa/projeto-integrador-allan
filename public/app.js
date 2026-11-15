const serviceIcons = { mariadb: "maria", mongodb: "mongo", redis: "redis", mqtt: "mqtt", minio: "minio" };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatClock(value) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function drawChart(points) {
  const line = document.querySelector("#chart-line");
  const fill = document.querySelector("#chart-fill");
  const dots = document.querySelector("#chart-points");
  const empty = document.querySelector("#chart-empty");
  const status = document.querySelector("#chart-status");
  const start = document.querySelector("#chart-start");
  const end = document.querySelector("#chart-end");

  if (!points.length) {
    line.setAttribute("d", "");
    fill.setAttribute("d", "");
    dots.replaceChildren();
    empty.hidden = false;
    status.textContent = "Aguardando dados";
    start.textContent = "—";
    end.textContent = "—";
    return;
  }

  empty.hidden = true;
  status.textContent = `${points.length} leituras`;
  const min = Math.min(0, ...points.map((point) => point.value));
  const max = Math.max(40, ...points.map((point) => point.value));
  const spread = Math.max(1, max - min);
  const coordinates = points.map((point, index) => ({
    x: 44 + index * (706 / Math.max(1, points.length - 1)),
    y: 198 - ((point.value - min) / spread) * 176,
  }));
  const path = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  line.setAttribute("d", path);
  fill.setAttribute("d", `${path} L${coordinates.at(-1).x.toFixed(1)},198 L${coordinates[0].x.toFixed(1)},198 Z`);
  dots.replaceChildren(...coordinates.map((point) => {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x.toFixed(1));
    circle.setAttribute("cy", point.y.toFixed(1));
    circle.setAttribute("r", "3.5");
    circle.setAttribute("class", "chart-point");
    return circle;
  }));
  start.textContent = points[0].time;
  end.textContent = points.at(-1).time;
}

function renderIntegrations(items) {
  document.querySelector("#integration-list").innerHTML = items.map((item) => {
    const icon = serviceIcons[item.id] || "maria";
    const state = item.connected ? "online" : item.configured ? "offline" : "pending";
    const detail = item.configured ? item.detail : "Configuração não encontrada";
    return `<div class="integration-row">
      <span class="service-icon ${icon}">${item.id === "mqtt" ? "⌁" : item.name[0]}</span>
      <div class="service-info"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(detail)}</small></div>
      <span class="status-dot ${state}" aria-label="${item.connected ? "Conectado" : "Desconectado"}"></span>
    </div>`;
  }).join("");
}

function renderActivity(readings) {
  const body = document.querySelector("#activity-body");
  if (!readings.length) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6"><span>⌁</span> Nenhuma atividade recebida. Aguardando mensagens do Grupo 1.</td></tr>';
    return;
  }

  body.innerHTML = readings.map((reading) => {
    const temperature = Number.isFinite(reading.temperature) ? `${reading.temperature.toFixed(1)} °C` : "—";
    const humidity = Number.isFinite(reading.humidity) ? `${reading.humidity.toFixed(1)}%` : "—";
    return `<tr>
      <td title="${escapeHtml(reading.topic)}">${escapeHtml(reading.farm || "Fazenda do Grupo 1")}${reading.plot ? ` · ${escapeHtml(reading.plot)}` : ""}</td>
      <td>${escapeHtml(reading.sensor)}</td>
      <td>${temperature}</td>
      <td>${humidity}</td>
      <td>${formatClock(reading.timestamp)}</td>
      <td><span class="table-status"><i></i> Recebido</span></td>
    </tr>`;
  }).join("");
}

function renderFarm(farm, plots, metrics) {
  document.querySelector("#farm-count").textContent = metrics.farmCount.toLocaleString("pt-BR");
  document.querySelector("#plot-count").textContent = `${metrics.plotCount.toLocaleString("pt-BR")} talhões`;
  const summary = farm
    ? `${farm.nome} · ${farm.municipio}/${farm.uf || "SP"}`
    : "Cadastro de fazendas do Grupo 1 indisponível";
  document.querySelector("#farm-summary").textContent = summary;
  const overview = document.querySelector("#farm-overview");
  if (!farm) {
    overview.innerHTML = '<div class="farm-placeholder">Nenhum cadastro disponível no MariaDB do Grupo 1.</div>';
    document.querySelector("#plot-grid").replaceChildren();
    return;
  }
  const area = Number(farm.area_total_ha);
  const mappedArea = Number(metrics.mappedArea);
  const unallocatedArea = Number(metrics.unallocatedArea);
  overview.innerHTML = `<div class="farm-identity"><span class="farm-symbol">⌂</span><div><strong>${escapeHtml(farm.nome)}</strong><small>${escapeHtml(farm.municipio)}${farm.uf ? `, ${escapeHtml(farm.uf)}` : ""}</small></div></div>
    <div class="farm-stat"><span>ÁREA CADASTRADA</span><strong>${Number.isFinite(area) ? area.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} ha</strong></div>
    <div class="farm-stat"><span>ÁREA EM TALHÕES</span><strong>${Number.isFinite(mappedArea) ? mappedArea.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} ha</strong></div>
    <div class="farm-stat"><span>DIFERENÇA SEM TALHÃO</span><strong>${Number.isFinite(unallocatedArea) ? `${unallocatedArea.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : "—"}</strong></div>
    <div class="farm-stat"><span>ALERTAS ABERTOS</span><strong>${metrics.openAlerts.toLocaleString("pt-BR")}</strong></div>`;
  const cropAreas = new Map();
  for (const plot of plots) {
    const crop = plot.cultura || "Cultura não informada";
    cropAreas.set(crop, (cropAreas.get(crop) || 0) + (Number(plot.area_ha) || 0));
  }
  document.querySelector("#crop-summary").textContent = cropAreas.size
    ? `Área por cultura · ${[...cropAreas].map(([crop, cropArea]) => `${crop}: ${cropArea.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha`).join(" · ")}`
    : "Área por cultura indisponível.";
  const plotGrid = document.querySelector("#plot-grid");
  if (!plots.length) {
    plotGrid.innerHTML = '<div class="farm-placeholder">Nenhum talhão cadastrado.</div>';
    return;
  }
  plotGrid.innerHTML = plots.map((plot) => {
    const plotArea = Number(plot.area_ha);
    return `<article class="plot-card">
      <div class="plot-card-top"><span class="plot-symbol">▧</span><strong>${escapeHtml(plot.codigo)}</strong><span class="plot-area">${Number.isFinite(plotArea) ? `${plotArea.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ha` : "—"}</span></div>
      <div class="plot-crop">${escapeHtml(plot.cultura || "Cultura não informada")}</div>
      <div class="plot-soil">${escapeHtml(plot.tipo_solo || "Solo não informado")}</div>
    </article>`;
  }).join("");
}

function renderDatabaseDetails(data) {
  document.querySelector("#historical-count").textContent = `${data.metrics.historicalReadings.toLocaleString("pt-BR")} registros`;
  const historyList = document.querySelector("#historical-list");
  historyList.innerHTML = data.historicalReadings.length
    ? data.historicalReadings.slice(0, 6).map((reading) => {
      const temperature = Number.isFinite(reading.temperature) ? `${reading.temperature.toFixed(1)} °C` : "—";
      const humidity = Number.isFinite(reading.humidity) ? `${reading.humidity.toFixed(1)}%` : "—";
      return `<div class="detail-row">
        <span class="detail-icon">⌁</span>
        <div class="detail-main"><strong>${escapeHtml(reading.sensor)}${reading.plot ? ` · ${escapeHtml(reading.plot)}` : ""}</strong><small>${new Date(reading.timestamp).toLocaleString("pt-BR")}</small></div>
        <span class="detail-value">${temperature}<small>${humidity}</small></span>
      </div>`;
    }).join("")
    : '<div class="farm-placeholder">Nenhuma leitura histórica encontrada no MongoDB.</div>';

  document.querySelector("#open-alert-count").textContent = `${data.metrics.openAlerts.toLocaleString("pt-BR")} alertas abertos`;
  const alertsList = document.querySelector("#alerts-list");
  alertsList.innerHTML = data.alerts.length
    ? data.alerts.slice(0, 4).map((alert) => {
      const resolved = alert.resolvido === true;
      const severity = String(alert.severidade || "info").toLowerCase();
      return `<div class="detail-row alert-row">
        <span class="alert-severity ${escapeHtml(severity)}">${escapeHtml(severity)}</span>
        <div class="detail-main"><strong>${escapeHtml(alert.tipo || "Alerta")}${alert.talhao ? ` · ${escapeHtml(alert.talhao)}` : ""}</strong><small>${escapeHtml(alert.mensagem || "Sem descrição")} · ${new Date(alert.ts).toLocaleDateString("pt-BR")}</small></div>
        <span class="alert-state ${resolved ? "resolved" : "unresolved"}">${resolved ? "Resolvido" : "Aberto"}</span>
      </div>`;
    }).join("")
    : '<div class="farm-placeholder">Nenhum alerta registrado.</div>';

  document.querySelector("#sensor-count").textContent = `${data.metrics.sensorCount.toLocaleString("pt-BR")} sensores`;
  const sensorList = document.querySelector("#sensor-list");
  sensorList.innerHTML = data.sensors.length
    ? data.sensors.map((sensor) => {
      const interval = Number(sensor.intervalo_min);
      const installed = sensor.instalado_em ? new Date(sensor.instalado_em).toLocaleDateString("pt-BR") : "instalação não informada";
      return `<div class="detail-row">
        <span class="detail-icon">◉</span>
        <div class="detail-main"><strong>${escapeHtml(sensor.codigo)} · ${escapeHtml(sensor.tipo)}</strong><small>${escapeHtml(sensor.talhao ? `Talhão ${sensor.talhao}` : "Sensor geral da fazenda")} · ${escapeHtml(sensor.fabricante || "Fabricante não informado")} · ${installed}</small></div>
        <span class="detail-value">${Number.isFinite(interval) ? `a cada ${interval} min` : "intervalo —"}</span>
      </div>`;
    }).join("")
    : '<div class="farm-placeholder">Nenhum sensor cadastrado no MariaDB.</div>';

  document.querySelector("#image-count").textContent = `${data.metrics.imageCount.toLocaleString("pt-BR")} metadados`;
  const reconciliation = document.querySelector("#image-reconciliation");
  reconciliation.textContent = data.metrics.imageReferencesFound === null
    ? "Conferência MinIO indisponível no momento."
    : `${data.metrics.imageReferencesFound}/${data.metrics.imageReferenceCount} referências encontradas · ${data.metrics.orphanMinioObjects} objetos sem metadado · ${data.metrics.imageReferencesMissing} referências sem objeto`;
  const imageList = document.querySelector("#image-list");
  imageList.innerHTML = data.images.length
    ? data.images.map((image) => {
      const date = image.data ? new Date(image.data).toLocaleDateString("pt-BR") : "data não informada";
      const ndvi = Number(image.ndvi_medio);
      const cloud = Number(image.cobertura_nuvem_pct);
      const resolution = Number(image.resolucao_m);
      const reference = [image.bucket, image.objeto].filter(Boolean).join("/");
      const objectStatus = image.objectPresent === true ? "objeto disponível no MinIO" : image.objectPresent === false ? "objeto não encontrado no MinIO" : "estado do objeto indisponível";
      return `<div class="detail-row image-row">
        <span class="detail-icon">▧</span>
        <div class="detail-main"><strong>${escapeHtml(reference || "Referência não informada")}</strong><small>${date} · ${escapeHtml(image.satelite || image.tipo || "Imagem")}${Number.isFinite(resolution) ? ` · ${resolution.toLocaleString("pt-BR")} m/px` : ""} · ${objectStatus}</small></div>
        <span class="detail-value">${Number.isFinite(ndvi) ? `NDVI ${ndvi.toFixed(2)}` : "NDVI —"}<small>${Number.isFinite(cloud) ? `nuvens ${cloud.toLocaleString("pt-BR")}%` : "nuvens —"}</small></span>
      </div>`;
    }).join("")
    : '<div class="farm-placeholder">Nenhum metadado de imagem encontrado.</div>';

  const machineList = document.querySelector("#machine-list");
  machineList.innerHTML = data.machines.length
    ? `<div class="machine-heading">ÚLTIMAS MÁQUINAS REPORTADAS</div>${data.machines.slice(0, 3).map((machine) => {
      const speed = Number(machine.velocidade_kmh);
      const fuel = Number(machine.combustivel_pct);
      return `<div class="machine-row"><span class="machine-icon">▰</span><strong>${escapeHtml(machine.maquina || "Máquina")}</strong><span>${escapeHtml(machine.tipo_maquina || "Atividade")} · ${escapeHtml(machine.talhao || "—")}</span><small>${Number.isFinite(speed) ? `${speed.toFixed(1)} km/h` : "—"} · combustível ${Number.isFinite(fuel) ? `${fuel.toFixed(0)}%` : "—"}</small></div>`;
    }).join("")}`
    : "";
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  if (!response.ok) throw new Error("Não foi possível carregar os dados do painel.");
  const data = await response.json();
  document.querySelector("#readings-history").textContent = data.metrics.historicalReadings.toLocaleString("pt-BR");
  document.querySelector("#active-sensors").textContent = data.metrics.activeSensors.toLocaleString("pt-BR");
  document.querySelector("#latest-temperature").textContent = data.metrics.latestTemperature === null
    ? "—"
    : data.metrics.latestTemperature.toFixed(1);
  renderFarm(data.farm, data.plots, data.metrics);
  renderDatabaseDetails(data);
  renderIntegrations(data.integrations);
  renderActivity(data.history);
  drawChart(data.chart);
  document.querySelector("#live-counter").textContent = `REDIS AO VIVO · ${(data.metrics.liveReadings || 0).toLocaleString("pt-BR")} LEITURAS`;
}

function showLoadError() {
  const chartStatus = document.querySelector("#chart-status");
  if (chartStatus) chartStatus.textContent = "Falha ao atualizar";
  const farmOverview = document.querySelector("#farm-overview");
  if (farmOverview) farmOverview.innerHTML = '<div class="farm-placeholder">Não foi possível atualizar os dados dos bancos.</div>';
}

const today = new Date();
document.querySelector("#today-day").textContent = today.toLocaleDateString("pt-BR", { weekday: "long" }).toUpperCase();
document.querySelector("#today-date").textContent = today.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).toUpperCase();
document.querySelector("#refresh-button").addEventListener("click", () => {
  loadDashboard().catch(showLoadError);
});

loadDashboard().catch(showLoadError);
window.setInterval(() => loadDashboard().catch(showLoadError), 5000);
