import './styles.css'
import { setPageTitle } from '@/utils/page-bootstrap'
import {
  OBSERVATION_TYPES,
  createEmptyStation,
  describeObservationTypes,
  describeStatus,
  initialStations,
  normalizeStation,
  validateStation
} from './station-model'
import { mountHydrologyAgentPanel } from './agent-panel'

setPageTitle('hydrologyWorkbench')

const stationFunctions = [
  {
    key: 'basic',
    label: '基础信息管理',
    meta: '站点基础资料、观测类别、数据源和校验阈值'
  },
  {
    key: 'realtime',
    label: '实时数据列表',
    meta: '水位和气温实时观测数据'
  },
  {
    key: 'review',
    label: '审核任务状态',
    meta: '缺测、边界、时序、变幅、毛刺和一致性检查'
  },
  {
    key: 'results',
    label: '工作成果展示',
    meta: '日统计、摘录成果、异常清单和人工确认记录'
  }
]

let stations = initialStations.map(normalizeStation)
let selectedStationId = stations[0]?.id || null
let activeFunctionKey = 'basic'

const stationTreeEl = document.getElementById('stationTree')
const newStationBtn = document.getElementById('newStationBtn')
const currentStationTitleEl = document.getElementById('currentStationTitle')
const currentStationMetaEl = document.getElementById('currentStationMeta')
const functionTabsEl = document.getElementById('functionTabs')
const activeFunctionTitleEl = document.getElementById('activeFunctionTitle')
const activeFunctionMetaEl = document.getElementById('activeFunctionMeta')
const tabContentEl = document.getElementById('tabContent')
const stationForm = document.getElementById('stationForm')
const stationFormError = document.getElementById('stationFormError')
const resetStationBtn = document.getElementById('resetStationBtn')
const hydrologyAgentPanelEl = document.getElementById('hydrologyAgentPanel')
let agentPanel = null

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getSelectedStation() {
  return stations.find((station) => station.id === selectedStationId) || stations[0] || null
}

function getActiveFunction() {
  return stationFunctions.find((item) => item.key === activeFunctionKey) || stationFunctions[0]
}

function groupStationsByBasin() {
  return stations.reduce((groups, station) => {
    const basin = station.basin || '未分组流域'
    groups[basin] ||= []
    groups[basin].push(station)
    return groups
  }, {})
}

function renderStationTree() {
  const groups = groupStationsByBasin()
  stationTreeEl.innerHTML = Object.entries(groups)
    .map(([basin, basinStations]) => `
      <section class="tree-group">
        <div class="tree-basin">${escapeHtml(basin)}</div>
        ${basinStations.map((station) => `
          <div class="tree-station ${station.id === selectedStationId ? 'active' : ''}">
            <button type="button" data-station-id="${escapeHtml(station.id)}">
              <strong>${escapeHtml(station.name)}</strong>
              <span>${escapeHtml(station.code)} · ${escapeHtml(describeStatus(station.status))}</span>
            </button>
          </div>
        `).join('')}
      </section>
    `)
    .join('')

  stationTreeEl.querySelectorAll('[data-station-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedStationId = button.dataset.stationId
      activeFunctionKey = 'basic'
      renderWorkbench()
    })
  })
}

function renderFunctionTabs() {
  functionTabsEl.innerHTML = stationFunctions
    .map((item) => `
      <button class="function-tab ${item.key === activeFunctionKey ? 'active' : ''}" type="button" data-function-key="${item.key}">
        ${escapeHtml(item.label)}
      </button>
    `)
    .join('')

  functionTabsEl.querySelectorAll('[data-function-key]').forEach((button) => {
    button.addEventListener('click', () => {
      activeFunctionKey = button.dataset.functionKey
      renderWorkbench()
    })
  })
}

function setCheckedValues(name, values) {
  stationForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
    input.checked = values.includes(input.value)
  })
}

function renderStationForm(station) {
  const nextStation = station || createEmptyStation()
  stationForm.hidden = false
  stationForm.dataset.stationId = nextStation.id || ''
  stationForm.elements.code.value = nextStation.code || ''
  stationForm.elements.name.value = nextStation.name || ''
  stationForm.elements.basin.value = nextStation.basin || ''
  stationForm.elements.river.value = nextStation.river || ''
  stationForm.elements.longitude.value = nextStation.longitude ?? ''
  stationForm.elements.latitude.value = nextStation.latitude ?? ''
  stationForm.elements.elevation.value = nextStation.elevation ?? ''
  stationForm.elements.status.value = nextStation.status || 'active'
  stationForm.elements.manual.checked = !!nextStation.dataSources?.manual
  stationForm.elements.videoOcr.checked = !!nextStation.dataSources?.videoOcr
  stationForm.elements.telemetry.checked = !!nextStation.dataSources?.telemetry
  stationForm.elements.waterLevelStatAt.value = nextStation.schedule?.waterLevelStatAt || '00:00'
  stationForm.elements.meteorologicalStatAt.value = nextStation.schedule?.meteorologicalStatAt || '20:00'
  stationForm.elements.waterLevelMaxHourlyChange.value = nextStation.validationRules?.waterLevel?.maxHourlyChange ?? 2
  setCheckedValues('observationTypes', nextStation.observationTypes || [OBSERVATION_TYPES.waterLevel])
  stationFormError.textContent = ''
}

function renderPlaceholderRows(rows) {
  tabContentEl.innerHTML = `
    <div class="data-surface">
      ${rows.map((row) => `
        <div class="data-row">
          <strong>${escapeHtml(row[0])}</strong>
          <span>${escapeHtml(row[1])}</span>
          <span>${escapeHtml(row[2])}</span>
          <em>${escapeHtml(row[3])}</em>
        </div>
      `).join('')}
    </div>
  `
}

function renderTabContent(station) {
  stationForm.hidden = true
  if (!station) {
    tabContentEl.innerHTML = '<div class="empty-state">请先选择或新建站点。</div>'
    return
  }

  if (activeFunctionKey === 'basic') {
    tabContentEl.innerHTML = ''
    renderStationForm(station)
    return
  }

  if (activeFunctionKey === 'realtime') {
    renderPlaceholderRows([
      ['00:00', '水位', '已到达', `${station.name} 等待统计摘录`],
      ['08:00', '气温', '已到达', '日内观测正常'],
      ['14:00', '水位', '待核对', '需与视频识别值比对'],
      ['20:00', '气温', '待统计', '气象日统计节点']
    ])
    return
  }

  if (activeFunctionKey === 'review') {
    renderPlaceholderRows([
      ['边界值', '待实现', describeObservationTypes(station.observationTypes), '按站点规则集检查'],
      ['时序合法性', '待实现', '水位 / 气温', '检查缺测、乱序、重复'],
      ['变幅与毛刺', '待实现', '水位', '识别突变和毛刺'],
      ['一致性比对', station.dataSources?.videoOcr ? '待实现' : '未启用', '水位', '人工值 vs 视频识别值']
    ])
    return
  }

  renderPlaceholderRows([
    ['水位日统计', station.schedule?.waterLevelStatAt || '00:00', '待生成', '含摘录与均值误差比较'],
    ['气象日统计', station.schedule?.meteorologicalStatAt || '20:00', '待生成', '气温日统计'],
    ['异常清单', '实时', '待生成', '缺失、可疑、确定性错误'],
    ['人工确认记录', '按需', '待生成', '修正与确认留痕']
  ])
}

function renderHeader(station) {
  const activeFunction = getActiveFunction()
  currentStationTitleEl.textContent = station?.name || '未选择站点'
  currentStationMetaEl.textContent = station
    ? `${station.code} · ${describeObservationTypes(station.observationTypes)} · ${station.basin || '未配置流域'}`
    : '请从左侧站点树选择站点'
  activeFunctionTitleEl.textContent = activeFunction.label
  activeFunctionMetaEl.textContent = activeFunction.meta
}

function renderWorkbench() {
  const station = getSelectedStation()
  renderStationTree()
  renderFunctionTabs()
  renderHeader(station)
  renderTabContent(station)
  agentPanel?.notifyContextChanged()
}

function collectStationFromForm() {
  const formData = new FormData(stationForm)
  const currentStation = stations.find((station) => station.id === stationForm.dataset.stationId)
  return normalizeStation({
    ...(currentStation || {}),
    id: stationForm.dataset.stationId || '',
    code: formData.get('code'),
    name: formData.get('name'),
    basin: formData.get('basin'),
    river: formData.get('river'),
    longitude: formData.get('longitude'),
    latitude: formData.get('latitude'),
    elevation: formData.get('elevation'),
    observationTypes: formData.getAll('observationTypes'),
    status: formData.get('status'),
    dataSources: {
      manual: formData.has('manual'),
      videoOcr: formData.has('videoOcr'),
      telemetry: formData.has('telemetry')
    },
    schedule: {
      waterLevelStatAt: formData.get('waterLevelStatAt'),
      meteorologicalStatAt: formData.get('meteorologicalStatAt'),
      waterLevelExcerptEnabled: true
    },
    validationRules: {
      ...(currentStation?.validationRules || {}),
      waterLevel: {
        ...(currentStation?.validationRules?.waterLevel || {}),
        maxHourlyChange: Number(formData.get('waterLevelMaxHourlyChange') || 0)
      }
    }
  })
}

function getAgentContext() {
  const station = getSelectedStation()
  const activeFunction = getActiveFunction()
  return {
    title: station ? `${station.name} / ${activeFunction.label}` : activeFunction.label,
    summary: station
      ? `当前站点：${station.name}（${station.code}），当前功能：${activeFunction.label}。`
      : '当前未选择站点。',
    payload: {
      appId: 'hydrology-workbench',
      station,
      function: activeFunction
    }
  }
}

stationForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const nextStation = collectStationFromForm()
  const errors = validateStation(nextStation)
  const duplicated = stations.some((station) => station.code === nextStation.code && station.id !== nextStation.id)
  if (duplicated) errors.push('站码不能重复')
  if (errors.length > 0) {
    stationFormError.textContent = errors.join('；')
    return
  }

  const existingIndex = stations.findIndex((station) => station.id === nextStation.id)
  if (existingIndex >= 0) {
    stations[existingIndex] = nextStation
  } else {
    stations = [...stations, nextStation]
  }
  selectedStationId = nextStation.id
  activeFunctionKey = 'basic'
  renderWorkbench()
})

resetStationBtn.addEventListener('click', () => {
  selectedStationId = null
  activeFunctionKey = 'basic'
  renderHeader(null)
  renderStationForm(createEmptyStation())
})

newStationBtn.addEventListener('click', () => {
  selectedStationId = null
  activeFunctionKey = 'basic'
  renderWorkbench()
  renderStationForm(createEmptyStation())
})

agentPanel = mountHydrologyAgentPanel({
  target: hydrologyAgentPanelEl,
  getContext: getAgentContext
})

renderWorkbench()
