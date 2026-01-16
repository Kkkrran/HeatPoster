type Artwork = {
  /** 云数据库 _id */
  id: string
  /** 用户 openid */
  _openid: string
  name: string
  updatedAt: number
  updatedAtText: string
  /** 云存储 fileID，用于列表头像预览 */
  thumbnail: string
  /** 云存储 fileID：原图/导出图（可选） */
  exportFileId?: string
}

type ArtworkDoc = {
  _id: string
  _openid: string
  name: string
  updatedAt: number
  thumbnailFileId?: string
  exportFileId?: string
}

const ENV_ID = 'art-9g2yt6t89a45335b'
const FUNCTION_ARTWORKS = 'artworks'

const formatDate = (ts: number) => {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

const ensureCloud = () => {
  if (!wx.cloud) return
  // 避免重复 init 报错
  try {
    wx.cloud.init({ env: ENV_ID })
  } catch (e) {
    // ignore
  }
}

const toArtwork = (doc: ArtworkDoc): Artwork => {
  const updatedAt = Number(doc.updatedAt ?? 0)
  return {
    id: doc._id,
    _openid: doc._openid,
    name: doc.name || '未命名作品',
    updatedAt,
    updatedAtText: updatedAt ? formatDate(updatedAt) : '',
    thumbnail: doc.thumbnailFileId || '',
    exportFileId: doc.exportFileId,
  }
}

Component({
  data: {
    artworks: [] as Artwork[],
    loading: false,
    moreVisible: false,
    currentArtworkId: '' as string,
    moreItems: [
      { label: '重命名', value: 'rename' },
      { label: '删除', value: 'delete', theme: 'danger' },
    ],
  },

  lifetimes: {
    attached() {
      const self = this as any
      ensureCloud()
      self.refresh()
    },
  },

  methods: {
    async refresh() {
      const self = this as any
      if (!wx.cloud) {
        wx.showToast({ title: '未检测到云开发能力', icon: 'none' })
        return
      }

      self.setData({ loading: true })
      try {
        const res = await wx.cloud.callFunction({
          name: FUNCTION_ARTWORKS,
          data: { action: 'list', limit: 50 },
        })

        const result = (res.result || {}) as any
        if (!result.ok) throw new Error(result.error || 'callFunction failed')

        const docs = (result.data || []) as unknown as ArtworkDoc[]
        const artworks = docs.map(toArtwork)
        self.setData({ artworks })
      } catch (err) {
        console.error('load artworks failed', err)
        wx.showToast({ title: '加载作品失败', icon: 'none' })
      } finally {
        self.setData({ loading: false })
      }
    },

    onCreate() {
      wx.navigateTo({ url: '/pages/editor/editor?mode=create' })
    },

    onOpen(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as any).id as string
      wx.navigateTo({ url: `/pages/editor/editor?id=${encodeURIComponent(id)}` })
    },

    onMore(e: WechatMiniprogram.TouchEvent) {
      const self = this as any
      const id = (e.currentTarget.dataset as any).id as string
      self.setData({ moreVisible: true, currentArtworkId: id })
    },

    onCloseMore() {
      const self = this as any
      self.setData({ moreVisible: false })
    },

    onMoreSelect(e: any) {
      const self = this as any
      console.log('onMoreSelect', e)
      // TDesign ActionSheet selected 事件 detail 结构通常为 { selected: Item, index: number }
      const { selected } = e.detail || {}
      const value = selected?.value

      const id = self.data.currentArtworkId
      self.setData({ moreVisible: false })
      if (!id) return

      switch (value) {
        case 'rename':
          self.renameArtwork(id)
          break
        case 'delete':
          self.deleteArtwork(id)
          break
        default:
          // 如果获取不到 value，尝试直接打印提示，便于调试
          if (!value) {
             console.warn('Unknown action value:', e.detail)
          }
      }
    },

    async renameArtwork(id: string) {
      const self = this as any
      const current = self.data.artworks.find((a: Artwork) => a.id === id)
      const defaultValue = current?.name || ''

      wx.showModal({
        title: '重命名作品',
        editable: true,
        placeholderText: '请输入作品名',
        confirmText: '保存',
        ...(defaultValue ? { defaultText: defaultValue } : {}),
        success: async r => {
          if (!r.confirm) return
          const name = String((r as any).content || '').trim()
          if (!name) {
            wx.showToast({ title: '名称不能为空', icon: 'none' })
            return
          }
          try {
            const cf = await wx.cloud.callFunction({
              name: FUNCTION_ARTWORKS,
              data: { action: 'rename', id, name },
            })
            const result = (cf.result || {}) as any
            if (!result.ok) throw new Error(result.error || 'rename failed')
            wx.showToast({ title: '已重命名', icon: 'success' })
            self.refresh()
          } catch (err) {
            console.error('rename failed', err)
            wx.showToast({ title: '重命名失败', icon: 'none' })
          }
        },
      })
    },

    async deleteArtwork(id: string) {
      const self = this as any
      wx.showModal({
        title: '确认删除？',
        content: '删除后将从作品库移除。',
        confirmText: '删除',
        confirmColor: '#e34d59',
        success: async r => {
          if (!r.confirm) return
          try {
            const cf = await wx.cloud.callFunction({
              name: FUNCTION_ARTWORKS,
              data: { action: 'delete', id },
            })
            const result = (cf.result || {}) as any
            if (!result.ok) throw new Error(result.error || 'delete failed')

            wx.showToast({ title: '已删除', icon: 'success' })
            self.refresh()
          } catch (err) {
            console.error('delete failed', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        },
      })
    },


    onGoSettings() {
      wx.navigateTo({ url: '/pages/settings/settings' })
    },

    onGoBrush() {
      wx.navigateTo({ url: '/pages/brush/brush' })
    },

  },
})
