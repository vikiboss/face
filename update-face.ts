/// <reference types="node" />
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import rawData from './raw/emoji.json' with { type: 'json' }

const faceDir = path.join(import.meta.dirname, './face')
const faceApngDir = path.join(faceDir, 'apng')
const facePngDir = path.join(faceDir, 'png')
const faceLottieDir = path.join(faceDir, 'lottie')
const tmpDir = path.join(import.meta.dirname, './raw/tmp')
const metaPath = path.join(faceDir, 'metadata.json')

for (const dir of [faceApngDir, facePngDir, faceLottieDir, tmpDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

const raw = rawData as any

// 完整表情来源，结构如下：
// data['4']['2']['1'] → 4 个 panel（超级/小黄脸/隐藏/emoji 表情）→ panel="normal"/"other"
// data['4']['3']['1'] → 5 个 sticker 组（QQ黄脸/汪汪/喜花妮/企鹅/噗噗星人）→ panel="super"
// data['4']['4']['1']['2'] → 骰子/包剪锤 → panel="redHeart"

type EmojiEntry = { emoji: RawEmoji; panel: string; group: string }
const allEntries: EmojiEntry[] = []

// panel 名称 → panel 标识（data['4']['2']['1']）
const panelTagMap: Record<string, string> = {
  '超级表情': 'normal',
  '小黄脸表情': 'normal',
  '隐藏表情': 'normal',
  'emoji 表情': 'other',
}

for (const panelData of raw['4']['2']['1'] as { '1': string; '2': RawEmoji[] }[]) {
  const group = panelData['1']
  const panelTag = panelTagMap[group] ?? 'other'
  for (const emoji of (panelData['2'] ?? [])) {
    allEntries.push({ emoji, panel: panelTag, group })
  }
}

for (const groupData of raw['4']['3']['1'] as { '1': string; '2': RawEmoji[] }[]) {
  const group = groupData['1']
  for (const emoji of (groupData['2'] ?? [])) {
    allEntries.push({ emoji, panel: 'super', group })
  }
}

for (const emoji of (raw['4']['4']['1']['2'] as RawEmoji[])) {
  allEntries.push({ emoji, panel: 'redHeart', group: '' })
}

interface RawEmoji {
  '1': string | Record<string, unknown> // emojiId，部分条目被编码为 {"7": n}
  '2': string  // describe，如 "/流泪"
  '3': string  // qzoneCode
  '4'?: number // unicode 代码点（仅 emoji 表情 panel）
  '5'?: number // 类型: 1=SUPER 2=RANDOM_SUPER 3=CHAIN_SUPER 4=EMOJI_EMOJI
  '6'?: number
  '7'?: number // 排序序号
  '8': {
    '1': string  // base zip 下载地址
    '2'?: string // adv zip 下载地址
  }
  '9'?: string[]
  '10'?: number  // 隐藏标记
  '13'?: number
  '14'?: number
}

// 字段 "5" → emojiType 字符串
const emojiTypeMap: Record<number, string> = {
  1: 'SUPER_EMOJI',
  2: 'RANDOM_SUPER_EMOJI',
  3: 'CHAIN_SUPER_EMOJI',
  4: 'EMOJI_EMOJI',
}

function getEmojiType(emoji: RawEmoji): string {
  const flag = emoji['5']
  return flag !== undefined ? (emojiTypeMap[flag] ?? 'NORMAL_EMOJI') : 'NORMAL_EMOJI'
}

// 部分条目的 "1" 字段被编码为对象，从下载 URL 里提取真实 emojiId
// URL 格式: .../singleres/{emojiId}_base_{timestamp}.zip
function resolveEmojiId(emoji: RawEmoji): string {
  if (typeof emoji['1'] === 'string') return emoji['1']
  const url = emoji['8']['1']
  const match = url.match(/\/(\w+)_base_\d+\.zip$/)
  return match ? match[1] : ''
}

function isApng(filePath: string): boolean {
  const buf = fs.readFileSync(filePath)
  for (let i = 8; i + 8 < buf.length;) {
    const len = buf.readUInt32BE(i)
    const name = buf.slice(i + 4, i + 8).toString('ascii')
    if (name === 'acTL') return true
    if (name === 'IDAT') return false // acTL 必须在 IDAT 之前
    i += 12 + len
  }
  return false
}

async function downloadFile(url: string, dest: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

async function fetchEmojiAssets(
  emojiId: string,
  name: string,
  baseUrl: string,
  advUrl?: string,
  idx?: string,
) {
  const apngDest = path.join(faceApngDir, `${emojiId}.png`)
  const pngDest = path.join(facePngDir, `${emojiId}.png`)
  const lottieDest = path.join(faceLottieDir, `${emojiId}.json`)
  const extractDir = path.join(tmpDir, emojiId)

  if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir, { recursive: true })

  const got: string[] = []

  try {
    if (advUrl) {
      const zipPath = path.join(tmpDir, `${emojiId}_adv.zip`)
      await downloadFile(advUrl, zipPath)
      execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' })
      fs.rmSync(zipPath, { force: true })

      const apngSrc = path.join(extractDir, emojiId, 'apng', `${emojiId}.png`)
      const lottieSrc = path.join(extractDir, emojiId, 'lottie', `${emojiId}.json`)
      if (fs.existsSync(apngSrc)) { fs.copyFileSync(apngSrc, apngDest); got.push('apng') }
      if (fs.existsSync(lottieSrc)) { fs.copyFileSync(lottieSrc, lottieDest); got.push('lottie') }
    }

    {
      const zipPath = path.join(tmpDir, `${emojiId}_base.zip`)
      await downloadFile(baseUrl, zipPath)
      execSync(`unzip -o "${zipPath}" -d "${extractDir}"`, { stdio: 'pipe' })
      fs.rmSync(zipPath, { force: true })

      // 优先用 _0.png（静态首帧），部分表情的 {id}.png 本身是 APNG
      const pngSrc0 = path.join(extractDir, emojiId, 'png', `${emojiId}_0.png`)
      const pngSrc = path.join(extractDir, emojiId, 'png', `${emojiId}.png`)
      const candidate = fs.existsSync(pngSrc0) ? pngSrc0 : pngSrc
      if (fs.existsSync(candidate)) {
        // 检查是否仍为 APNG（acTL chunk），若是则用 ffmpeg 提取第一帧
        if (isApng(candidate)) {
          execSync(`ffmpeg -y -i "${candidate}" -vframes 1 "${pngDest}"`, { stdio: 'pipe' })
        } else {
          fs.copyFileSync(candidate, pngDest)
        }
        got.push('png')
      }
    }

    console.log(`  [${idx}] ${emojiId} ${name}  →  ${got.join(' + ') || '(无资源)'}`)
  } catch (err) {
    console.warn(`  [${idx}] ${emojiId} ${name}  ✗  ${(err as Error).message}`)
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
}

// 加载现有 metadata，仅用于继承 stickerId/stickerPackId
type FaceItem = {
  id: number
  emojiId: number
  stickerId: number
  stickerPackId: number
  emojiType: string
  name: string
  describe: string
  src: string
  download: { base: string; advance: string }
  apng: boolean
  png: boolean
  lottie: boolean
  qzoneCode: string
  panel: string
  group: string
}

const existingMap = new Map<number, FaceItem>()
if (fs.existsSync(metaPath)) {
  const existing: FaceItem[] = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  for (const item of existing) {
    if (item.id <= 999) existingMap.set(item.id, item)
  }
  console.log(`加载现有 metadata: ${existing.length} 条`)
}
const originalSize = existingMap.size

// 收集所有需要下载的条目（去重、排除 EMOJI_EMOJI 和 id > 999）
const downloadQueue: { emoji: RawEmoji; emojiId: string }[] = []
const dlSeen = new Set<string>()
for (const { emoji } of allEntries) {
  if (getEmojiType(emoji) === 'EMOJI_EMOJI') continue
  const emojiId = resolveEmojiId(emoji)
  if (!emojiId || dlSeen.has(emojiId)) continue
  dlSeen.add(emojiId)
  downloadQueue.push({ emoji, emojiId })
}

console.log(`\n开始下载资源，共 ${downloadQueue.length} 个表情...`)
let dlIdx = 0
for (const { emoji, emojiId } of downloadQueue) {
  dlIdx++
  await fetchEmojiAssets(
    emojiId,
    emoji['2'],
    emoji['8']['1'],
    emoji['8']['2'],
    `${dlIdx}/${downloadQueue.length}`,
  )
}

console.log('\n资源下载完成，生成元数据...')

// emoji.json 为基准增量更新：有就覆盖，没有就新增，旧有 emoji.json 无的保留不动
// stickerId/stickerPackId 从旧 metadata 继承（新协议无此字段）
// 同一 emojiId 在 emoji.json 多处出现时，取第一次（data['4']['2']['1'] 优先）
const addedIds: number[] = []
let updatedCount = 0
const processedFromEmoji = new Set<number>()

for (const { emoji, panel: panelTag, group: groupName } of allEntries) {
  const emojiId = resolveEmojiId(emoji)
  if (!emojiId) continue

  const emojiType = getEmojiType(emoji)
  // 普通数字 id；EMOJI_EMOJI 用 unicode 码点（"4" 字段）作为 id
  const numericId = /^\d+$/.test(emojiId) ? +emojiId : (emoji['4'] ?? NaN)

  if (isNaN(numericId as number)) continue

  const id = numericId as number
  // 排除 emoji 表情（id 超过三位数，即 unicode 码点）
  if (id > 999) continue
  // 同一 emojiId 在 emoji.json 多处出现时，取第一次（data['4']['2']['1'] 优先）
  if (processedFromEmoji.has(id)) continue
  processedFromEmoji.add(id)

  const hasApng = fs.existsSync(path.join(faceApngDir, `${emojiId}.png`))
  const hasPng = fs.existsSync(path.join(facePngDir, `${emojiId}.png`))
  const hasLottie = fs.existsSync(path.join(faceLottieDir, `${emojiId}.json`))

  const existing = existingMap.get(id)

  existingMap.set(id, {
    id,
    emojiId: id,
    stickerId: existing?.stickerId ?? 0,
    stickerPackId: existing?.stickerPackId ?? 0,
    emojiType,
    name: emoji['2'].replace('/', ''),
    describe: emoji['2'],
    src: hasApng || hasPng
      ? `https://face.viki.moe/${hasApng ? 'apng' : 'png'}/${emojiId}.png`
      : '',
    download: {
      base: emoji['8']['1'],
      advance: emoji['8']['2'] ?? '',
    },
    apng: hasApng,
    png: hasPng,
    lottie: hasLottie,
    qzoneCode: emoji['3'],
    panel: panelTag,
    group: groupName,
  })

  if (existing) updatedCount++
  else addedIds.push(id)
}

const preservedCount = originalSize - updatedCount
console.log(`  更新: ${updatedCount} 条`)
console.log(`  新增: ${addedIds.length} 条  →  ${addedIds.join(', ') || '无'}`)
console.log(`  保留 (emoji.json 中不存在): ${preservedCount} 条`)

const faceList = [...existingMap.values()].sort((a, b) => a.id - b.id)
fs.writeFileSync(metaPath, JSON.stringify(faceList, null, 2))
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n完成，metadata 总计 ${faceList.length} 条`)
