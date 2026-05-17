import { createApp } from 'vue'
import { create, NMessageProvider, NDialogProvider, NConfigProvider } from 'naive-ui'
import EmbeddedAgentPanel from '@/components/embedded-agent/EmbeddedAgentPanel.vue'
import { createEmbeddedAppRuntimeBridge } from '@/components/embedded-agent/embedded-app-runtime-bridge'

export function mountHydrologyAgentPanel({ target, getContext, commandHandler, cwd = '' }) {
  if (!target) return null
  let lastContextSignature = null

  const naive = create({
    components: [
      NConfigProvider,
      NMessageProvider,
      NDialogProvider
    ]
  })

  const app = createApp(EmbeddedAgentPanel, {
    appId: 'hydrology-workbench',
    appLabel: '',
    title: '',
    cwd,
    contextProvider: getContext
  })

  app.use(naive)
  app.mount(target)

  const runtimeBridge = createEmbeddedAppRuntimeBridge(window.hydroAgent, {
    appId: 'hydrology-workbench',
    getContext,
    commandHandler
  })
  const disposeCommandHandler = runtimeBridge?.registerCommandHandler?.() || (() => {})

  return {
    async notifyContextChanged(force = false) {
      const nextContext = typeof getContext === 'function' ? getContext() : null
      const nextSignature = JSON.stringify(nextContext || null)
      if (!force && nextSignature === lastContextSignature) {
        return false
      }
      lastContextSignature = nextSignature
      await runtimeBridge?.syncContext?.()
      window.dispatchEvent(new CustomEvent('embedded-agent:context-changed'))
      return true
    },
    unmount() {
      disposeCommandHandler()
      app.unmount()
    }
  }
}
