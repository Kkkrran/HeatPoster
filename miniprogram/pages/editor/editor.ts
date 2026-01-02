Component({
  data: {
    toolsVisible: false,
    brushRadius: 18,
    heatRate: 1.0,
    canRedo: false,
  },

  lifetimes: {
    attached() {
      // 原型阶段先不接入真实热力绘制逻辑；这里仅做页面与交互骨架
      // 后续可以在这里初始化 canvas 2d context、heatmap 数据结构、undo/redo 栈等
    },
  },

  methods: {
    toast(message: string) {
      wx.showToast({ title: message, icon: 'none' })
    },

    openTools() {
      this.setData({ toolsVisible: true })
    },

    closeTools() {
      this.setData({ toolsVisible: false })
    },

    onToolsVisibleChange(e: any) {
      // t-popup 会回传 visible
      const { visible } = e.detail || {}
      this.setData({ toolsVisible: !!visible })
    },

    onBrushRadiusChange(e: any) {
      const v = Number(e.detail?.value ?? 18)
      this.setData({ brushRadius: v })
    },

    onHeatRateChange(e: any) {
      const v = Number(e.detail?.value ?? 1.0)
      this.setData({ heatRate: v })
    },

    onUndo() {
      this.toast('撤回（占位）')
      this.setData({ canRedo: true })
    },

    onRedo() {
      this.toast('重做（占位）')
      this.setData({ canRedo: false })
    },

    onClear() {
      this.toast('清空（占位，需二次确认）')
    },

    onSave() {
      wx.showToast({ title: '保存成功（占位）', icon: 'success' })
    },
  },
})
