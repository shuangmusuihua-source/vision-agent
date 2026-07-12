import cron from 'node-cron'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { buildAgentOptions } from './agent-options'
import type { CronScheduleParseRequest, CronScheduleParseResponse } from '../shared/cron-types'

const DEFAULT_HOUR = 9
const DEFAULT_MINUTE = 0
const WEEKDAY_VALUES: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
}

function normalizeInput(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, '')
    .replace(/礼拜/g, '星期')
    .replace(/週/g, '周')
    .replace(/兩/g, '二')
}

function parseInteger(raw: string | undefined): number | null {
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number.parseInt(raw, 10)

  const text = raw.replace(/两/g, '二')
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (text in digits) return digits[text]
  if (text === '十') return 10
  if (text.startsWith('十')) {
    const tail = digits[text.slice(1)]
    return tail === undefined ? null : 10 + tail
  }
  if (text.includes('十')) {
    const [head, tail] = text.split('十')
    const tens = digits[head]
    if (tens === undefined) return null
    return tens * 10 + (tail ? digits[tail] ?? 0 : 0)
  }
  return null
}

function normalizeHour(hour: number, period?: string): number {
  if ((period === '下午' || period === '晚上' || period === '傍晚') && hour < 12) return hour + 12
  if (period === '中午' && hour < 11) return hour + 12
  if ((period === '凌晨' || period === '早上' || period === '上午') && hour === 12) return 0
  return hour
}

function parseTime(input: string): { hour: number; minute: number } {
  const colonMatch = input.match(/(凌晨|早上|上午|中午|下午|晚上|傍晚)?([0-2]?\d)[:：]([0-5]?\d)/)
  if (colonMatch) {
    return {
      hour: normalizeHour(Number.parseInt(colonMatch[2], 10), colonMatch[1]),
      minute: Number.parseInt(colonMatch[3], 10),
    }
  }

  const timeMatch = input.match(/(凌晨|早上|上午|中午|下午|晚上|傍晚)?([0-2]?\d|[一二两三四五六七八九十]{1,3})(?:点|時|时)(半|[0-5]?\d分?)?/)
  if (timeMatch) {
    const parsedHour = parseInteger(timeMatch[2])
    if (parsedHour !== null) {
      const minutePart = timeMatch[3]
      const minute = minutePart === '半'
        ? 30
        : minutePart
          ? Number.parseInt(minutePart.replace('分', ''), 10)
          : DEFAULT_MINUTE
      return {
        hour: normalizeHour(parsedHour, timeMatch[1]),
        minute: Number.isNaN(minute) ? DEFAULT_MINUTE : minute,
      }
    }
  }

  return { hour: DEFAULT_HOUR, minute: DEFAULT_MINUTE }
}

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function uniqueWeekdays(values: number[]): string {
  return Array.from(new Set(values)).join(',')
}

function parseExplicitWeekdays(input: string): string | null {
  const rangeMatch = input.match(/(?:周|星期)([一二三四五六日天])(?:到|至|-)(?:周|星期)?([一二三四五六日天])/)
  if (rangeMatch) {
    const start = WEEKDAY_VALUES[rangeMatch[1]]
    const end = WEEKDAY_VALUES[rangeMatch[2]]
    if (start !== undefined && end !== undefined) return `${start}-${end}`
  }

  const compactMatch = input.match(/每(?:周|星期)([一二三四五六日天、,，和与及]+)/)
  if (compactMatch) {
    const values = compactMatch[1]
      .split('')
      .map((char) => WEEKDAY_VALUES[char])
      .filter((value): value is number => value !== undefined)
    if (values.length > 0) return uniqueWeekdays(values)
  }

  const matches = Array.from(input.matchAll(/(?:周|星期)([一二三四五六日天])/g))
  if (matches.length > 0) {
    return uniqueWeekdays(matches.map((match) => WEEKDAY_VALUES[match[1]]).filter((value): value is number => value !== undefined))
  }
  return null
}

function isValidCronExpression(expression: string): boolean {
  const trimmed = expression.trim()
  return trimmed.split(/\s+/).length === 5 && cron.validate(trimmed)
}

function success(cronExpression: string, normalizedText: string): CronScheduleParseResponse | null {
  if (!isValidCronExpression(cronExpression)) return null
  return {
    success: true,
    cronExpression,
    normalizedText,
    source: 'rule',
  }
}

export function parseCronScheduleWithRules(input: string): CronScheduleParseResponse | null {
  const text = normalizeInput(input)
  if (!text) return null

  const halfHour = /每(?:隔)?半(?:个)?小时/.test(text)
  if (halfHour) return success('*/30 * * * *', '每 30 分钟')

  const minuteInterval = text.match(/每(?:隔)?([0-9一二两三四五六七八九十]+)(?:分钟|分)/)
  if (minuteInterval) {
    const minutes = parseInteger(minuteInterval[1])
    if (minutes && minutes > 0 && minutes < 60) return success(`*/${minutes} * * * *`, `每 ${minutes} 分钟`)
  }

  if (/每(?:个)?小时|每一小时/.test(text)) return success('0 * * * *', '每小时')

  const hourInterval = text.match(/每(?:隔)?([0-9一二两三四五六七八九十]+)(?:个)?小时/)
  if (hourInterval) {
    const hours = parseInteger(hourInterval[1])
    if (hours && hours > 0 && hours < 24) return success(`0 */${hours} * * *`, `每 ${hours} 小时`)
  }

  const { hour, minute } = parseTime(text)
  const clock = formatClock(hour, minute)

  const monthly = text.match(/每(?:个)?月(?:的)?([0-9一二两三四五六七八九十]+)(?:日|号)/)
  if (monthly) {
    const day = parseInteger(monthly[1])
    if (day && day >= 1 && day <= 31) return success(`${minute} ${hour} ${day} * *`, `每月 ${day} 日 ${clock}`)
  }

  if (/工作日|周一到周五|星期一到星期五/.test(text)) {
    return success(`${minute} ${hour} * * 1-5`, `每个工作日 ${clock}`)
  }

  if (/周末|星期六日|周六日|周六和周日|星期六和星期日/.test(text)) {
    return success(`${minute} ${hour} * * 6,0`, `每个周末 ${clock}`)
  }

  const weekday = parseExplicitWeekdays(text)
  if (weekday) return success(`${minute} ${hour} * * ${weekday}`, `每周 ${weekday} ${clock}`)

  if (/每天|每日|天天|每天早上|每天上午|每天晚上/.test(text)) {
    return success(`${minute} ${hour} * * *`, `每天 ${clock}`)
  }

  return null
}

function extractJson(text: string): Record<string, unknown> | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
}

async function resolveWithModel(request: CronScheduleParseRequest): Promise<CronScheduleParseResponse> {
  const timezone = request.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
  const now = new Date(request.now || Date.now()).toISOString()
  const options = buildAgentOptions({
    memoryMode: 'disabled',
    cwd: process.cwd(),
    permissionMode: 'default',
    allowedTools: [],
    settingSources: [],
    skills: [],
    prependUserBinPaths: false,
    effort: 'low',
    maxTurns: 2,
    canUseTool: async () => ({ behavior: 'deny', message: 'Cron schedule parsing must not use tools' }),
  })
  options.persistSession = false
  options.systemPrompt = `你是一个自动化任务的时间表达式解析器。
把用户的中文或英文周期性时间描述转换成 5 字段 Cron 表达式：minute hour day-of-month month day-of-week。
只处理重复执行的任务，不处理一次性提醒。
规则：
- 周日使用 0，周一到周六使用 1-6。
- 工作日使用 1-5。
- 没有明确分钟时用 0 分；没有明确时间但能判断为每日/每周/月度任务时用 09:00。
- 不能确定、Cron 无法表达或是一次性时间时，返回 error。
- 只返回 JSON，不要解释，不要 Markdown。`

  const prompt = `当前时区：${timezone}
当前时间：${now}
用户描述：${request.input}

返回格式：
{"cronExpression":"0 9 * * 1-5","normalizedText":"每个工作日 09:00"}
或：
{"error":"无法转换为周期性 Cron 表达式"}`

  let result = ''
  for await (const message of query({ prompt, options })) {
    if (message.type === 'result' && message.subtype === 'success') {
      result = message.result || ''
    }
  }

  const parsed = extractJson(result)
  const cronExpression = typeof parsed?.cronExpression === 'string' ? parsed.cronExpression.trim() : ''
  if (cronExpression && isValidCronExpression(cronExpression)) {
    return {
      success: true,
      cronExpression,
      normalizedText: typeof parsed?.normalizedText === 'string' ? parsed.normalizedText : request.input.trim(),
      source: 'model',
    }
  }

  const error = typeof parsed?.error === 'string' && parsed.error.trim()
    ? parsed.error.trim()
    : '无法识别为可重复执行的时间表达式'
  return { success: false, error }
}

export async function resolveCronSchedule(request: CronScheduleParseRequest): Promise<CronScheduleParseResponse> {
  const input = request.input.trim()
  if (!input) return { success: false, error: '请先描述执行频率' }

  const ruleResult = parseCronScheduleWithRules(input)
  if (ruleResult) return ruleResult

  try {
    return await resolveWithModel({ ...request, input })
  } catch (err) {
    return {
      success: false,
      error: (err as Error).message || '解析执行频率失败',
    }
  }
}
