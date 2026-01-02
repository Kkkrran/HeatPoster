type Artwork = {
  id: string
  name: string
  updatedAt: number
  updatedAtText: string
  thumbnail: string
}

const formatDate = (ts: number) => {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}/${m}/${day}`
}

Component({
  data: {
    artworks: [] as Artwork[],
    moreVisible: false,
    currentArtworkId: '' as string,
    moreItems: [
      { label: '重命名（占位）', value: 'rename' },
      { label: '删除（占位）', value: 'delete', theme: 'danger' },
      { label: '导出到相册（占位）', value: 'export' },
    ],
  },

  lifetimes: {
    attached() {
      // 原型阶段：用 mock 数据占位
      const now = Date.now()
      const artworks: Artwork[] = [
        {
          id: 'a1',
          name: '未命名作品',
          updatedAt: now,
          updatedAtText: formatDate(now),
          // 这里用空字符串也可，avatar 会显示默认占位
          thumbnail: '',
        },
        {
          id: 'a2',
          name: '热力练习',
          updatedAt: now - 24 * 3600 * 1000,
          updatedAtText: formatDate(now - 24 * 3600 * 1000),
          thumbnail: '',
        },
      ]
      this.setData({ artworks })
    },
  },

  methods: {
    onCreate() {
      wx.navigateTo({ url: '/pages/editor/editor?mode=create' })
    },

    onOpen(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as any).id as string
      wx.navigateTo({ url: `/pages/editor/editor?id=${encodeURIComponent(id)}` })
    },

    onMore(e: WechatMiniprogram.TouchEvent) {
      const id = (e.currentTarget.dataset as any).id as string
      this.setData({ moreVisible: true, currentArtworkId: id })
    },

    onCloseMore() {
      this.setData({ moreVisible: false })
    },

    onMoreSelect(e: any) {
      const { value } = e.detail || {}
      const id = this.data.currentArtworkId
      this.setData({ moreVisible: false })
      wx.showToast({
        title: `${value}：${id}`,
        icon: 'none',
      })
    },

    onGoSettings() {
      wx.navigateTo({ url: '/pages/settings/settings' })
    },
  },
})
