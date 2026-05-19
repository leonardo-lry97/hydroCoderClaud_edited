import { createApp } from 'vue'
import {
  create,
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NButton,
  NSpace,
  NInput,
  NInputNumber,
  NSelect,
  NFormItem,
  NSwitch,
  NAlert,
  NCard,
  NTag
} from 'naive-ui'
import App from './App.vue'
import '../../styles/settings-common.css'
import { renderBootstrapError, setPageTitle } from '@/utils/page-bootstrap'

console.log('[ChannelSettings] Initializing Vue app...')
setPageTitle('channelSettings')

const naive = create({
  components: [
    NConfigProvider,
    NMessageProvider,
    NDialogProvider,
    NButton,
    NSpace,
    NInput,
    NInputNumber,
    NSelect,
    NFormItem,
    NSwitch,
    NAlert,
    NCard,
    NTag
  ]
})

try {
  const app = createApp(App)
  app.config.errorHandler = (err, vm, info) => {
    console.error('[ChannelSettings] Vue Error:', err)
    console.error('[ChannelSettings] Info:', info)
    renderBootstrapError('vue', err)
  }
  app.use(naive)
  app.mount('#app')
  console.log('[ChannelSettings] Vue app mounted successfully')
} catch (err) {
  console.error('[ChannelSettings] Failed to initialize:', err)
  renderBootstrapError('initialization', err)
}
