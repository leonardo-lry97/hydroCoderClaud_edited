<template>
  <div class="provider-row" :class="{ selected }" @click="$emit('select', provider)">
    <div class="provider-main">
      <span class="provider-name">{{ provider.name }}</span>
    </div>
    <div class="provider-actions">
      <n-button size="tiny" quaternary @click.stop="$emit('edit', provider)">
        {{ t('common.edit') }}
      </n-button>
      <n-button size="tiny" quaternary type="error" @click.stop="$emit('delete', provider.id)">
        {{ t('common.delete') }}
      </n-button>
    </div>
  </div>
</template>

<script setup>
import { useLocale } from '@composables/useLocale'

const { t } = useLocale()

defineProps({
  provider: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  }
})

defineEmits(['edit', 'delete', 'select'])
</script>

<style scoped>
.provider-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  border: 1px solid var(--border-color, #e7e2d8);
  border-radius: 10px;
  background: var(--bg-color-secondary, white);
  color: var(--text-color, #2d2d2d);
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  cursor: pointer;
}

.provider-row:hover {
  border-color: var(--border-color-light, #d9d5ca);
  box-shadow: 0 0 0 1px rgba(var(--primary-color-rgb, 230, 57, 91), 0.08);
  transform: translateY(-1px);
}

.provider-row.selected {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 1px var(--primary-color);
}

.provider-row.selected:hover {
  border-color: var(--primary-color);
  box-shadow:
    0 0 0 1px var(--primary-color),
    0 8px 20px rgba(var(--primary-color-rgb, 230, 57, 91), 0.14);
}

.provider-main {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  padding-right: 12px;
}

.provider-name {
  display: block;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
  min-width: 120px;
}
</style>
