import fs from 'node:fs'
import path from 'node:path'
import config from '../raw/sys_emoji_config.json' with { type: 'json' }

const rawDir = path.join(import.meta.dirname, '../raw')
const faceDir = path.join(import.meta.dirname, '../face')

const faceApngDir = path.join(faceDir, './apng')
const facePngDir = path.join(faceDir, './png')
const faceLottieDir = path.join(faceDir, './lottie')

;[faceApngDir, facePngDir, faceLottieDir].forEach(dir => {
  !fs.existsSync(dir) && fs.mkdirSync(dir)
})

// 错别字... system 不是 syastem
const rawFaceDir = path.join(rawDir, 'BaseEmojiSyastems/EmojiSystermResource')
const dirents = fs.readdirSync(rawFaceDir, { withFileTypes: true })

const list = {
  apng: [] as string[],
  png: [] as string[],
  lottie: [] as string[],
}

for (const dirent of dirents) {
  if (dirent.isDirectory()) {
    if (/^\d+$/.test(dirent.name)) {
      const apngPath = path.join(rawFaceDir, dirent.name, 'apng', `${dirent.name}.png`)
      const pngPath = path.join(rawFaceDir, dirent.name, 'png', `${dirent.name}.png`)
      const lottiePath = path.join(rawFaceDir, dirent.name, 'lottie', `${dirent.name}.json`)

      if (fs.existsSync(apngPath)) {
        list.apng.push(dirent.name)
        fs.copyFileSync(apngPath, path.join(faceApngDir, `${dirent.name}.png`))
      }

      if (fs.existsSync(pngPath)) {
        list.png.push(dirent.name)
        fs.copyFileSync(pngPath, path.join(facePngDir, `${dirent.name}.png`))
      }

      if (fs.existsSync(lottiePath)) {
        list.lottie.push(dirent.name)
        fs.copyFileSync(lottiePath, path.join(faceLottieDir, `${dirent.name}.json`))
      }
    }
  }
}

const faceList: {
  id: number
  emojiId: number
  stickerId: number
  stickerPackId: number
  emojiType: string
  name: string
  describe: string
  src: string
  download: {
    base: string
    advance: string
  }
  apng: boolean
  png: boolean
  lottie: boolean
  qzoneCode: string
  panel: string
  group: string
}[] = []

const panelNames = ['normal', 'super', 'redHeart', 'other']

;[
  config.normalPanelResult,
  config.superPanelResult,
  config.redHeartPanelResult,
  config.otherPanelResult,
].forEach((group, idx) => {
  group.SysEmojiGroupList.forEach(group =>
    group.SysEmojiList.filter(e => e.emojiType !== 'EMOJI_EMOJI').forEach(emoji => {
      const hasApng = list.apng.includes(emoji.emojiId)
      const hasPng = list.png.includes(emoji.emojiId)
      const hasLottie = list.lottie.includes(emoji.emojiId)

      faceList.push({
        id: +emoji.emojiId,
        emojiId: +emoji.emojiId,
        stickerId: +emoji.aniStickerId,
        stickerPackId: +emoji.aniStickerPackId,
        emojiType: emoji.emojiType, // 'SUPER_EMOJI', 'RANDOM_SUPER_EMOJI', 'CHAIN_SUPER_EMOJI', 'NORMAL_EMOJI', 'EMOJI_EMOJI'
        name: emoji.describe.replace('/', ''),
        describe: emoji.describe,
        src:
          hasApng || hasPng
            ? `https://github.com/vikiboss/static-face-host/raw/refs/heads/main/face/${hasApng ? 'apng' : 'png'}/${emoji.emojiId}.png`
            : '',
        download: {
          base: emoji.downloadInfo.baseResDownloadUrl,
          advance: emoji.downloadInfo.advancedResDownloadUrl,
        },
        apng: hasApng,
        png: hasPng,
        lottie: hasLottie,
        qzoneCode: emoji.qzoneCode,
        panel: panelNames[idx],
        group: group.groupName,
      })
    })
  )
})

faceList.sort((a, b) => a.id - b.id)

console.log('done, count:', faceList.length)

fs.writeFileSync(path.join(faceDir, 'metadata.json'), JSON.stringify(faceList, null, 2))
