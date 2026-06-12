/**
 * IM Bridge 共享工具函数
 *
 * 从 dingtalk-bridge / feishu-bridge / weixin-bridge 中提取的逐字重复代码。
 */

const fs = require('fs')
const path = require('path')

// ─── 图片提取 ───

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp)$/i
const IMAGE_MAX_SIZE = 20 * 1024 * 1024 // 20MB
const IMAGE_PATH_MAX_DEPTH = 10

/**
 * 递归提取对象中的图片文件绝对路径
 * @param {*} obj - 要搜索的对象/字符串
 * @param {number} [depth=0] - 当前递归深度
 * @returns {string[]} 去重后的绝对图片路径列表
 */
function extractImagePaths(obj, depth = 0) {
  if (depth > IMAGE_PATH_MAX_DEPTH) return []
  if (!obj || typeof obj !== 'object') return []

  const paths = []
  for (const value of Object.values(obj)) {
    if (typeof value === 'string') {
      if (IMAGE_EXTENSIONS.test(value) && (value.startsWith('/') || /^[A-Z]:[/\\]/.test(value))) {
        paths.push(normalizePath(value))
      }
    } else if (typeof value === 'object' && value !== null) {
      paths.push(...extractImagePaths(value, depth + 1))
    }
  }
  return paths
}

/**
 * 归一化路径：MSYS 风格 /c/... → Windows C:/...（仅 Windows）
 * @param {string} rawPath
 * @returns {string}
 */
function normalizePath(rawPath) {
  if (process.platform === 'win32') {
    const m = rawPath.match(/^\/([a-zA-Z])\/(.*)$/)
    if (m) return `${m[1].toUpperCase()}:/${m[2]}`
  }
  return rawPath
}

function isAbsoluteLocalPath(value) {
  if (typeof value !== 'string') return false
  const normalizedValue = normalizePath(value.trim())
  if (!normalizedValue) return false
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalizedValue)) return false
  return path.isAbsolute(normalizedValue)
}

async function validateLocalImagePaths(imagePaths = []) {
  const normalizedPaths = Array.isArray(imagePaths)
    ? imagePaths.map(item => typeof item === 'string' ? normalizePath(item.trim()) : '').filter(Boolean)
    : []

  if (normalizedPaths.length === 0) {
    return []
  }

  const validated = []
  for (const imagePath of normalizedPaths) {
    if (!isAbsoluteLocalPath(imagePath)) {
      throw new Error(`图片路径必须是本地绝对路径: ${imagePath}`)
    }
    if (!IMAGE_EXTENSIONS.test(imagePath)) {
      throw new Error(`图片路径必须是受支持的图片文件: ${imagePath}`)
    }
    const stats = await fs.promises.stat(imagePath).catch(() => null)
    if (!stats || !stats.isFile()) {
      throw new Error(`图片文件不存在: ${imagePath}`)
    }
    if (stats.size <= 0) {
      throw new Error(`图片文件为空: ${imagePath}`)
    }
    if (stats.size > IMAGE_MAX_SIZE) {
      throw new Error(`图片文件不能超过 ${Math.floor(IMAGE_MAX_SIZE / (1024 * 1024))}MB: ${imagePath}`)
    }
    validated.push(imagePath)
  }

  return validated
}

// ─── 时间格式化 ───

/**
 * 将时间戳格式化为相对时间字符串
 * @param {number} timestamp - 毫秒时间戳
 * @returns {string}
 */
function formatRelativeTime(timestamp) {
  const value = Number(timestamp)
  if (!Number.isFinite(value) || value <= 0) return '未知时间'

  const diff = Date.now() - value
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  const week = 7 * day

  if (diff < hour) return `${Math.max(1, Math.floor(diff / min))}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < week) return `${Math.floor(diff / day)}天前`
  if (diff < 30 * day) return `${Math.floor(diff / week)}周前`
  return `${Math.floor(diff / (30 * day))}个月前`
}

module.exports = {
  IMAGE_EXTENSIONS,
  IMAGE_MAX_SIZE,
  IMAGE_PATH_MAX_DEPTH,
  extractImagePaths,
  normalizePath,
  isAbsoluteLocalPath,
  validateLocalImagePaths,
  formatRelativeTime,
}
