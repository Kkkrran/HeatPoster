// miniprogram/pages/editor/editor.ts

// 导入打印机SDK
import bleToothManage from '../../SUPVANAPIT50PRO/BLEToothManage.js'
import constants from '../../SUPVANAPIT50PRO/Constants.js'

// 定义笔触点结构
interface HeatPoint {
  x: number
  y: number
  r: number
  opacity: number
}

// 定义笔画结构（已使用，但TypeScript可能检测不到）
// type Stroke = HeatPoint[]

Page({

  data: {
    toolsVisible: false,
    brushRadius: 40,
    heatRate: 0.6,
    canUndo: false,
    canRedo: false,
    openid: '',
    snapshotUrl: '',
    isCanvasHidden: false,
    backgroundImage: '', // 临时背景图
    permanentBackgroundImage: '', // 常驻背景图
    permanentBackgroundAspectRatio: undefined as number | undefined, // 常驻背景的宽高比
    canvasContainerStyle: '', // canvas容器的动态样式
    artworkId: '',

    hasUnsavedChanges: false,
    maxUndoSteps: 10,
    // 打印相关
    connectedDevice: null as any,
    printCanvasCtx: null as any,
    printSettingsVisible: false, // 打印参数设置弹窗可见性
    // 打印参数（默认值）
    printWidth: 50,      // 纸张宽度（mm）
    printHeight: 70,     // 纸张高度（mm）
    printCopies: 1,      // 打印份数
    printDensity: 6,    // 打印密度（1-15）
    printSpeed: 60,     // 打印速度（1-100）
    printRotate: 1,      // 旋转（1-4）
    printPaperType: 1,  // 纸张类型（1-3）
    printGap: 3,        // 间隙（mm）
  },

  async onLoad(options: any) {
    // 初始化实例变量
    Object.assign(this, {
      strokes: [], // ... existing ...
      redoStack: [],
      currentStroke: [], // ... existing ...
      needsRender: false,
      renderLoopId: 0
    })
    // 先加载常驻背景，然后再初始化画布（这样可以根据常驻背景的比例调整画布）
    await this.loadPermanentBackground()
    // 等待画布初始化完成
    await this.initCanvas()
    this.initPrintCanvas()
    this.checkPrinterConnection()
    this.loadPrintSettings() // 加载保存的打印参数
    this.getOpenId()
    
    if (options && options.id) {
      this.setData({ artworkId: options.id })
      // 画布已经初始化完成，现在可以安全地加载作品
      this.loadArtwork(options.id)
    }
  },
  
  onUnload() {
    const self = this as any
    if (self.renderLoopId) {
      self.canvas.cancelAnimationFrame(self.renderLoopId)
    }
  },
  
  onShow() {
    const maxUndoSteps = wx.getStorageSync('editor_max_undo_steps') || 50
    this.setData({ maxUndoSteps })
    this.updateExitConfirmState()
    // 每次显示页面时检查打印机连接状态
    this.checkPrinterConnection()
    // 重新加载常驻背景（可能用户在设置页面修改了）
    this.loadPermanentBackground()
  },

  updateExitConfirmState() {
    let exitConfirm = wx.getStorageSync('editor_exit_confirm')
    if (exitConfirm === '') exitConfirm = true // 默认为开启

    const hasUnsavedChanges = this.data.hasUnsavedChanges
    if (exitConfirm && hasUnsavedChanges) {
      wx.enableAlertBeforeUnload({
        message: '当前有未保存的修改，退出将丢失更改，确定退出吗？',
        success: (res) => { console.log('enableAlertBeforeUnload success', res) },
        fail: (err) => { console.log('enableAlertBeforeUnload fail', err) }
      })
    } else {
      wx.disableAlertBeforeUnload({
        success: (res) => { console.log('disableAlertBeforeUnload success', res) },
        fail: (err) => { console.log('disableAlertBeforeUnload fail', err) }
      })
    }
  },

  async getOpenId() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'editor',
        data: { action: 'getOpenId' }
      })
      const result = res.result as any
      if (!result.ok) {
        console.error('getOpenId cloud error:', result)
        return
      }
      const openid = result.data.openid
      this.setData({ openid })
    } catch (e) {
      console.error('getOpenId failed', e)
    }
  },

  // 加载常驻背景
  async loadPermanentBackground() {
    try {
      const selectedBg = wx.getStorageSync('selected_background')
      if (selectedBg && selectedBg.tempFilePath) {
        // 如果有保存的常驻背景，加载它
        this.setData({ 
          permanentBackgroundImage: selectedBg.tempFilePath 
        })
        
        // 如果有宽高比信息，也保存下来
        if (selectedBg.aspectRatio) {
          this.setData({ 
            permanentBackgroundAspectRatio: selectedBg.aspectRatio 
          })
        } else {
          // 如果没有宽高比信息，尝试获取
          try {
            const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
              wx.getImageInfo({
                src: selectedBg.tempFilePath,
                success: resolve,
                fail: reject,
              })
            })
            const aspectRatio = imageInfo.width / imageInfo.height
            this.setData({ permanentBackgroundAspectRatio: aspectRatio })
            // 更新存储中的宽高比信息
            wx.setStorageSync('selected_background', {
              ...selectedBg,
              aspectRatio
            })
          } catch (err) {
            console.warn('获取常驻背景图片信息失败', err)
          }
        }
      } else {
        // 没有常驻背景，清空
        this.setData({ 
          permanentBackgroundImage: '',
          permanentBackgroundAspectRatio: undefined
        })
      }
    } catch (err) {
      console.error('加载常驻背景失败', err)
    }
  },

  toast(message: string, theme: 'success' | 'error' | 'warning' | 'loading' | 'info' = 'info') {
    const toast = this.selectComponent('#t-toast') as any
    if (!toast || typeof toast.show !== 'function') return
    toast.show({
      theme,
      direction: 'column',
      message,
      duration: 1800,
    })
  },

  initCanvas(): Promise<void> {
    return new Promise((resolve) => {
      const query = this.createSelectorQuery()
      // 先查询canvas-wrap容器，获取可用空间
      query.select('.canvas-wrap')
        .boundingClientRect()
        .exec((wrapRes) => {
          const wrapInfo = wrapRes[0]
          if (!wrapInfo) {
            resolve()
            return
          }

          // 如果有常驻背景比例，根据比例调整canvas容器尺寸（无论是新建还是加载）
          let canvasContainerStyle = ''
          if (this.data.permanentBackgroundAspectRatio) {
            const aspectRatio = this.data.permanentBackgroundAspectRatio
            const maxWidth = wrapInfo.width - 48 // 减去左右padding (24rpx * 2)
            const maxHeight = wrapInfo.height - 24 // 减去底部padding
            
            // 计算适合的尺寸（保持比例，尽量填满容器）
            let targetWidth = maxHeight * aspectRatio
            let targetHeight = maxHeight
            
            // 如果宽度超出容器，则按宽度缩放
            if (targetWidth > maxWidth) {
              targetWidth = maxWidth
              targetHeight = maxWidth / aspectRatio
            }
            
            // 设置canvas容器的样式（使用rpx单位）
            const systemInfo = wx.getSystemInfoSync()
            const rpxRatio = systemInfo.windowWidth / 750
            const targetWidthRpx = targetWidth / rpxRatio
            const targetHeightRpx = targetHeight / rpxRatio
            canvasContainerStyle = `width: ${targetWidthRpx}rpx; height: ${targetHeightRpx}rpx; margin: 0 auto;`
          }

          this.setData({ canvasContainerStyle })

          // 查询canvas元素
          const canvasQuery = this.createSelectorQuery()
          canvasQuery.select('#paintCanvas')
            .fields({ node: true, size: true })
            .exec((res) => {
              if (!res[0] || !res[0].node) {
                resolve()
                return
              }
              const canvas = res[0].node
              const ctx = canvas.getContext('2d')
              // @ts-ignore
              const dpr = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).pixelRatio
              
              const self = this as any
              self.canvas = canvas
              self.ctx = ctx
              self.dpr = dpr
              
              // 如果设置了容器样式，需要等待下一帧再获取实际尺寸
              if (canvasContainerStyle) {
                setTimeout(() => {
                  const sizeQuery = this.createSelectorQuery()
                  sizeQuery.select('#paintCanvas')
                    .boundingClientRect()
                    .exec((sizeRes) => {
                      if (!sizeRes[0]) {
                        resolve()
                        return
                      }
                      const rect = sizeRes[0]
                      self.width = rect.width
                      self.height = rect.height

                      canvas.width = rect.width * dpr
                      canvas.height = rect.height * dpr
                      ctx.scale(dpr, dpr)

                      // 初始化离屏 Canvas
                      // @ts-ignore
                      self.memCanvas = wx.createOffscreenCanvas({ type: '2d', width: canvas.width, height: canvas.height })
                      self.memCtx = self.memCanvas.getContext('2d')

                      this.initPalette()
                      this.startRenderLoop()
                      resolve()
                    })
                }, 100)
              } else {
                // 没有设置容器样式，使用默认尺寸
                self.width = res[0].width
                self.height = res[0].height

                canvas.width = res[0].width * dpr
                canvas.height = res[0].height * dpr
                ctx.scale(dpr, dpr)

                // 初始化离屏 Canvas
                // @ts-ignore
                self.memCanvas = wx.createOffscreenCanvas({ type: '2d', width: canvas.width, height: canvas.height })
                self.memCtx = self.memCanvas.getContext('2d')

                this.initPalette()
                this.startRenderLoop()
                resolve()
              }
            })
        })
    })
  },

  initPalette() {
    // @ts-ignore
    const pCanvas = wx.createOffscreenCanvas({ type: '2d', width: 256, height: 1 })
    const pCtx = pCanvas.getContext('2d')
    
    const grad = pCtx.createLinearGradient(0, 0, 256, 0)
    grad.addColorStop(0.0, "rgba(0,0,0,0)")
    grad.addColorStop(0.2, "rgba(0,0,255,0.2)")
    grad.addColorStop(0.3, "rgba(43,111,231,0.3)")
    grad.addColorStop(0.4, "rgba(2,192,241,0.4)")
    grad.addColorStop(0.6, "rgba(44,222,148,0.6)")
    grad.addColorStop(0.8, "rgba(254,237,83,0.8)")
    grad.addColorStop(0.9, "rgba(255,118,50,0.9)")
    grad.addColorStop(1.0, "rgba(255,10,0,0.95)")
    
    pCtx.fillStyle = grad
    pCtx.fillRect(0, 0, 256, 1)
    
    const imageData = pCtx.getImageData(0, 0, 256, 1)
    const self = this as any
    self.palette = imageData.data
  },

  startRenderLoop() {
    const self = this as any
    const loop = () => {
      if (self.needsRender) {
        this.render()
        self.needsRender = false
      }
      self.renderLoopId = self.canvas.requestAnimationFrame(loop)
    }
    self.renderLoopId = self.canvas.requestAnimationFrame(loop)
  },

  onTouchStart(e: any) {
    const { x, y } = e.touches[0]
    const self = this as any
    self.currentStroke = []
    this.addPoint(x, y)
  },

  onTouchMove(e: any) {
    const { x, y } = e.touches[0]
    this.addPoint(x, y)
  },

  onTouchEnd(_e: any) {
    const self = this as any
    if (self.currentStroke.length > 0) {
      self.strokes.push(self.currentStroke)
      self.redoStack = []
      this.setData({ 
        canUndo: true,
        canRedo: false,
        hasUnsavedChanges: true
      })
      this.updateExitConfirmState()
      self.currentStroke = []
    }
  },

  addPoint(x: number, y: number) {
    const self = this as any
    if (!self.memCtx) return
    const point: HeatPoint = {
      x,
      y,
      r: this.data.brushRadius,
      opacity: 0.05 * this.data.heatRate
    }
    self.currentStroke.push(point)
    this.drawAlphaPoint(point)
    self.needsRender = true
  },

  drawAlphaPoint(p: HeatPoint) {
    const self = this as any
    const ctx = self.memCtx
    const dpr = self.dpr
    const cx = p.x * dpr
    const cy = p.y * dpr
    const r = p.r * dpr
    
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, `rgba(0,0,0,${p.opacity})`)
    grad.addColorStop(1, "rgba(0,0,0,0)")
    
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, 2 * Math.PI)
    ctx.fill()
  },

  render() {
    const self = this as any
    if (!self.palette || !self.memCtx || !self.ctx) return
    
    const w = self.memCanvas.width
    const h = self.memCanvas.height
    
    const imageData = self.memCtx.getImageData(0, 0, w, h)
    const data = imageData.data
    const palette = self.palette
    
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]
      if (alpha > 0) {
        const offset = alpha * 4
        data[i] = palette[offset]
        data[i + 1] = palette[offset + 1]
        data[i + 2] = palette[offset + 2]
        data[i + 3] = palette[offset + 3]
      }
    }
    
    self.ctx.putImageData(imageData, 0, 0)
  },

  redrawAll() {
    const self = this as any
    if (!self.memCtx) return
    self.memCtx.clearRect(0, 0, self.memCanvas.width, self.memCanvas.height)
    
    for (const stroke of self.strokes) {
      for (const p of stroke) {
        this.drawAlphaPoint(p)
      }
    }
    
    self.needsRender = true
  },

  openTools() {
    const self = this as any
    // 生成快照以解决原生 Canvas 遮挡 Popup 的问题
    wx.canvasToTempFilePath({
      canvas: self.canvas,
      fileType: 'png',
      quality: 0.8,
      success: (res) => {
        this.setData({
          snapshotUrl: res.tempFilePath,
          isCanvasHidden: true,
          toolsVisible: true
        })
      },
      fail: (err) => {
        console.error('snapshot failed', err)
        // 降级处理：直接打开，虽然可能会遮挡
        this.setData({ toolsVisible: true })
      }
    })
  },

  closeTools() {
    this.setData({ 
      toolsVisible: false,
      isCanvasHidden: false
    })
  },

  onToolsVisibleChange(e: any) {
    const { visible } = e.detail || {}
    this.setData({ 
      toolsVisible: !!visible,
      // 当弹窗关闭（点击遮罩层）时，也要恢复 Canvas 显示
      isCanvasHidden: !!visible 
    })
  },

  onBrushRadiusChange(e: any) {
    console.log('onBrushRadiusChange', e)
    const { value } = e.detail || {}
    if (value !== undefined) {
      this.setData({ brushRadius: value })
    }
  },

  onHeatRateChange(e: any) {
    console.log('onHeatRateChange', e)
    const { value } = e.detail || {}
    if (value !== undefined) {
      this.setData({ heatRate: value })
    }
  },

  onBackgroundChange(e: any) {
    const { url } = e.detail || {}
    if (url) {
      this.setData({ backgroundImage: url })
    }
  },

  onUndo() {
    const self = this as any
    if (self.strokes.length === 0) return

    // 检查 undo 栈是否达到了用户设置的最大步数限制
    if (self.redoStack.length >= this.data.maxUndoSteps) {
      // 如果 redo 栈满了，可能不再允许 undo 更多进来？通常 undo 限制是指 history slot 的数量。
      // 这里的实现暂且保留原样，确保 UI 设置是生效并被读取的。
    }

    const stroke = self.strokes.pop()
    if (stroke) {
      self.redoStack.push(stroke)
      this.setData({ 
        canUndo: self.strokes.length > 0,
        canRedo: true,
        hasUnsavedChanges: true
      })
      this.updateExitConfirmState()
      this.redrawAll()
      this.toast('已撤回')
    }
  },

  onRedo() {
    const self = this as any
    if (self.redoStack.length === 0) return
    const stroke = self.redoStack.pop()
    if (stroke) {
      self.strokes.push(stroke)
      this.setData({ 
        canUndo: true,
        canRedo: self.redoStack.length > 0,
        hasUnsavedChanges: true
      })
      this.updateExitConfirmState()
      for (const p of stroke) {
        this.drawAlphaPoint(p)
      }
      self.needsRender = true
      this.toast('已重做')
    }
  },

  onClear() {
    const self = this as any
    self.strokes = []
    self.redoStack = []
    this.setData({ 
      canUndo: false, 
      canRedo: false,
      hasUnsavedChanges: true
    })
    this.updateExitConfirmState()
    this.redrawAll()
    this.toast('画布已清空')
  },

  async onSave() {
    const self = this as any
    if (self.strokes.length === 0) {
      this.toast('画布为空', 'warning')
      return
    }
    
    this.toast('正在保存...', 'loading')
    
    try {
      // 确保作品 id 在上传前就存在，这样多次保存会使用相同的文件名
      let id = this.data.artworkId
      if (!id) {
        // 创建新作品时，如果有常驻背景，使用常驻背景的比例
        let width = self.width
        let height = self.height

        if (this.data.permanentBackgroundAspectRatio) {
          // 根据常驻背景的比例调整画布尺寸
          // 保持当前画布的高度，根据比例调整宽度
          const containerHeight = self.height
          width = containerHeight * this.data.permanentBackgroundAspectRatio
          height = containerHeight
        }

        const res = await wx.cloud.callFunction({
          name: 'editor',
          data: { 
            action: 'create',
            name: '未命名作品',
            width: width,
            height: height
          }
        })
        // @ts-ignore
        id = res.result.data.id
        this.setData({ artworkId: id })
      }

      // 使用 artwork id 作为文件名的一部分，确保多次保存保持一致
      const strokesData = JSON.stringify(self.strokes)
      const fs = wx.getFileSystemManager()
      const pointsPath = `${wx.env.USER_DATA_PATH}/${id}_points.json`
      fs.writeFileSync(pointsPath, strokesData, 'utf8')

      const openid = this.data.openid || 'unknown'
      const { fileID: pointsFileId } = await wx.cloud.uploadFile({
        cloudPath: `artworks/${openid}/${id}_points.json`,
        filePath: pointsPath
      })

      // 使用getComposedImagePath生成包含常驻背景和临时背景的合成图
      const composedImagePath = await this.getComposedImagePath()

      const { fileID: thumbnailFileId } = await wx.cloud.uploadFile({
        cloudPath: `artworks/${openid}/${id}_thumb.png`,
        filePath: composedImagePath
      })

      await wx.cloud.callFunction({
        name: 'editor',
        data: {
          action: 'savePoints',
          id,
          pointsFileId,
          thumbnailFileId
        }
      })

      this.setData({ hasUnsavedChanges: false })
      this.updateExitConfirmState()
      this.toast('保存成功', 'success')

      // 保存成功后直接导出合成图到相册（不再弹窗）
      try {
        // 这里复用之前生成并上传时的 composedImagePath，这样避免重复合成
        // 注意：composedImagePath 在上方已定义并生成
        if (typeof composedImagePath === 'string' && composedImagePath) {
          await this.saveComposedToAlbum(composedImagePath)
        } else {
          // 保险起见，若不存在则重新生成一次
          const composedPathLocal = await this.getComposedImagePath()
          await this.saveComposedToAlbum(composedPathLocal)
        }
      } catch (err) {
        console.error('导出到相册失败', err)
      }
      
    } catch (err) {
      console.error(err)
      this.toast('保存失败', 'error')
    }
  },
  
  async loadArtwork(id: string) {
    const self = this as any
    this.toast('加载中...', 'loading')
    try {
      const res = await wx.cloud.callFunction({
        name: 'editor',
        data: { action: 'get', id }
      })
      // @ts-ignore
      const data = res.result.data
      if (data && data.pointsFileId) {
        const downloadRes = await wx.cloud.downloadFile({ fileID: data.pointsFileId })
        const fs = wx.getFileSystemManager()
        const jsonStr = fs.readFileSync(downloadRes.tempFilePath, 'utf8')
        const strokes = JSON.parse(jsonStr as string)
        
        self.strokes = strokes
        this.redrawAll()
        this.setData({ canUndo: true })
      }
      this.toast('加载完成', 'success')
    } catch (err) {
      console.error(err)
      this.toast('加载失败', 'error')
    }
  },

  onImportBackground() {
    const self = this as any
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        const tempFilePaths = res.tempFilePaths
        if (tempFilePaths.length > 0) {
          const src = tempFilePaths[0]
          
          // @ts-ignore
          if (wx.editImage) {
            // @ts-ignore
            wx.editImage({
              src: src,
              success: (editRes: any) => {
                self.setData({
                  backgroundImage: editRes.tempFilePath,
                  // 关闭工具面板，以便查看背景
                  toolsVisible: false,
                  isCanvasHidden: false
                })
              },
              fail: (err: any) => {
                console.log('editImage cancelled or failed', err)
                // 用户取消编辑时，也可以选择不做任何事
              }
            })
          } else {
            self.toast('当前微信版本不支持图片编辑', 'error')
          }
        }
      }
    })
  },

    /**
   * 将本地合成图保存到相册（处理授权）
   */
  async saveComposedToAlbum(filePath: string) {
    if (!filePath) {
      this.toast('未找到可导出的图片', 'error')
      return
    }

    return new Promise<void>((resolve) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          this.toast('已保存到相册', 'success')
          resolve()
        },
        fail: (err: any) => {
          console.error('saveImageToPhotosAlbum failed', err)
          // 如果是授权问题，引导用户去设置
          const errMsg = (err && err.errMsg) || ''
          if (errMsg.includes('auth') || errMsg.includes('authorize') || errMsg.includes('fail')) {
            wx.showModal({
              title: '需要授权',
              content: '请授权“保存到相册”以便导出图片',
              confirmText: '去设置',
              cancelText: '取消',
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting()
                }
                resolve()
              },
              fail: () => resolve()
            })
          } else {
            this.toast('保存到相册失败', 'error')
            resolve()
          }
        }
      })
    })
  },

    /**
   * 合成背景图与热力图，返回合并后的临时文件路径
   */
  async getComposedImagePath(): Promise<string> {
    const self = this as any
    const dpr = self.dpr
    const width = self.width * dpr
    const height = self.height * dpr

    // 1. 创建一个临时的离屏 Canvas 用于合成
    // @ts-ignore
    const offscreenCanvas = wx.createOffscreenCanvas({ type: '2d', width, height })
    const offscreenCtx = offscreenCanvas.getContext('2d')

    // 2. 先绘制常驻背景（最底层）
    if (this.data.permanentBackgroundImage) {
      // @ts-ignore - 离屏 Canvas 的 createImage 方法
      const permanentBgImg = offscreenCanvas.createImage()
      permanentBgImg.src = this.data.permanentBackgroundImage
      await new Promise((resolve) => {
        permanentBgImg.onload = resolve
        permanentBgImg.onerror = resolve // 容错处理
      })
      offscreenCtx.drawImage(permanentBgImg, 0, 0, width, height)
    } else {
      // 无常驻背景则填充白色底
      offscreenCtx.fillStyle = '#ffffff'
      offscreenCtx.fillRect(0, 0, width, height)
    }

    // 3. 再绘制临时背景（中间层，如果有的话）
    if (this.data.backgroundImage) {
      // @ts-ignore - 离屏 Canvas 的 createImage 方法
      const bgImg = offscreenCanvas.createImage()
      bgImg.src = this.data.backgroundImage
      await new Promise((resolve) => {
        bgImg.onload = resolve
        bgImg.onerror = resolve // 容错处理
      })
      offscreenCtx.drawImage(bgImg, 0, 0, width, height)
    }

    // 4. 获取当前热力图的 ImageData 并处理颜色映射
    if (self.memCtx && self.palette) {
      const heatmapData = self.memCtx.getImageData(0, 0, width, height)
      const pixels = heatmapData.data
      const palette = self.palette

      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3]
        if (alpha > 0) {
          const offset = alpha * 4
          pixels[i] = palette[offset]
          pixels[i + 1] = palette[offset + 1]
          pixels[i + 2] = palette[offset + 2]
          pixels[i + 3] = palette[offset + 3]
        }
      }

      // 5. 将热力图绘制到合成画布上
      // @ts-ignore
      const tempHeatmapCanvas = wx.createOffscreenCanvas({ type: '2d', width, height })
      const tempHeatmapCtx = tempHeatmapCanvas.getContext('2d')
      tempHeatmapCtx.putImageData(heatmapData, 0, 0)
      
      offscreenCtx.drawImage(tempHeatmapCanvas, 0, 0, width, height)
    }

    // 6. 导出合成后的图片
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: offscreenCanvas,
        fileType: 'png',
        quality: 1,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      })
    })
  },

  // ========== 打印功能 ==========

  // 检查打印机连接状态
  checkPrinterConnection() {
    const savedDevice = wx.getStorageSync('connected_printer_device')
    if (savedDevice) {
      this.setData({ connectedDevice: savedDevice })
    } else {
      this.setData({ connectedDevice: null })
    }
  },

  // 初始化打印Canvas
  initPrintCanvas() {
    try {
      // 使用 createCanvasContext 创建传统 Canvas 上下文（与 SDK 示例保持一致）
      const ctx = wx.createCanvasContext('printCanvasWx', this as any)
      if (ctx) {
        this.setData({ printCanvasCtx: ctx })
        console.log('打印Canvas初始化成功')
      }
    } catch (error) {
      console.error('打印Canvas初始化失败:', error)
    }
  },

  // 点击打印按钮 - 显示参数设置弹窗
  onPrint() {
    const self = this as any

    // 检查是否已连接打印机
    if (!this.data.connectedDevice) {
      wx.showModal({
        title: '未连接打印机',
        content: '未连接打印机，请在设置界面连接',
        showCancel: true,
        confirmText: '去设置',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/settings/settings' })
          }
        }
      })
      return
    }

    // 检查画布是否有内容
    if (!self.strokes || self.strokes.length === 0) {
      this.toast('画布为空，无法打印', 'warning')
      return
    }

    // 显示打印参数设置弹窗
    this.setData({ printSettingsVisible: true })
  },

  // 加载保存的打印参数（如果没有则使用默认值）
  loadPrintSettings() {
    const saved = wx.getStorageSync('print_settings')
    if (saved) {
      // 如果有保存的参数，使用保存的值
      this.setData({
        printWidth: saved.printWidth || 50,
        printHeight: saved.printHeight || 70,
        printCopies: saved.printCopies || 1,
        printDensity: saved.printDensity || 6,
        printSpeed: saved.printSpeed || 60,
        printRotate: saved.printRotate || 1,
        printPaperType: saved.printPaperType || 1,
        printGap: saved.printGap || 3,
      })
    }
    // 如果没有保存的参数，使用 data 中定义的默认值
  },

  // 保存打印参数
  savePrintSettings() {
    wx.setStorageSync('print_settings', {
      printWidth: this.data.printWidth,
      printHeight: this.data.printHeight,
      printCopies: this.data.printCopies,
      printDensity: this.data.printDensity,
      printSpeed: this.data.printSpeed,
      printRotate: this.data.printRotate,
      printPaperType: this.data.printPaperType,
      printGap: this.data.printGap,
    })
  },

  // 关闭打印参数设置弹窗
  onClosePrintSettings() {
    this.setData({ printSettingsVisible: false })
  },

  // 打印参数变化处理
  onPrintWidthChange(e: any) {
    // TDesign input 的 change 事件返回 { value: string }
    const value = parseFloat(e.detail?.value || e.detail || String(this.data.printWidth)) || this.data.printWidth
    this.setData({ printWidth: value })
  },

  onPrintHeightChange(e: any) {
    const value = parseFloat(e.detail?.value || e.detail || String(this.data.printHeight)) || this.data.printHeight
    this.setData({ printHeight: value })
  },

  onPrintCopiesChange(e: any) {
    const value = parseInt(e.detail?.value || e.detail || String(this.data.printCopies)) || this.data.printCopies
    this.setData({ printCopies: Math.max(1, Math.min(100, value)) })
  },

  onPrintDensityChange(e: any) {
    const value = parseInt(e.detail.value) || 6
    this.setData({ printDensity: Math.max(1, Math.min(15, value)) })
  },

  onPrintSpeedChange(e: any) {
    const value = parseInt(e.detail.value) || 60
    this.setData({ printSpeed: Math.max(1, Math.min(100, value)) })
  },

  onPrintRotateChange(e: any) {
    const value = parseInt(e.detail.value) || 1
    this.setData({ printRotate: Math.max(1, Math.min(4, value)) })
  },

  onPrintPaperTypeChange(e: any) {
    const value = parseInt(e.detail.value) || 1
    this.setData({ printPaperType: Math.max(1, Math.min(3, value)) })
  },

  onPrintGapChange(e: any) {
    const value = parseFloat(e.detail?.value || e.detail || String(this.data.printGap)) || this.data.printGap
    this.setData({ printGap: value })
  },

  // 设置旋转角度
  onSetRotate(e: any) {
    const value = parseInt(e.currentTarget.dataset.value) || 1
    this.setData({ printRotate: value })
  },

  // 设置纸张类型
  onSetPaperType(e: any) {
    const value = parseInt(e.currentTarget.dataset.value) || 1
    this.setData({ printPaperType: value })
  },

  // 打印参数弹窗可见性变化
  onPrintSettingsVisibleChange(e: any) {
    this.setData({ printSettingsVisible: e.detail.visible })
  },

  // 确认打印 - 执行实际打印操作
  async onConfirmPrint() {
    // 检查打印Canvas是否初始化
    if (!this.data.printCanvasCtx) {
      this.toast('打印Canvas未初始化', 'error')
      return
    }

    // 保存当前参数设置
    this.savePrintSettings()

    // 关闭参数设置弹窗
    this.setData({ printSettingsVisible: false })

    try {
      this.toast('正在生成图片...', 'loading')
      
      // 生成合成图片
      const composedPath = await this.getComposedImagePath()

      // 询问用户是否先保存到相册或直接打印
      try {
        const modalRes = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
          wx.showModal({
            title: '导出或打印',
            content: '是否先将合成图片保存到相册再打印？（确定：保存并打印，取消：直接打印）',
            confirmText: '保存并打印',
            cancelText: '直接打印',
            success: resolve,
            fail: () => resolve({ confirm: false, cancel: true } as any)
          })
        })

        if (modalRes.confirm) {
          await this.saveComposedToAlbum(composedPath)
        }
      } catch (err) {
        console.error('保存并打印流程出错', err)
      }

      // 使用用户设置的打印参数
      const PageImageObject = [{
        "Width": String(this.data.printWidth),
        "Height": String(this.data.printHeight),
        "Rotate": String(this.data.printRotate),
        "Copies": String(this.data.printCopies),
        "Density": String(this.data.printDensity),
        "HorizontalNum": "0",
        "VerticalNum": "0",
        "PaperType": String(this.data.printPaperType),
        "Gap": String(this.data.printGap),
        "DeviceSn": this.data.connectedDevice.deviceId || this.data.connectedDevice.name || '',
        "ImageUrl": composedPath,
        "ImageWidth": String(this.data.printWidth), // 图片宽（单位mm）
        "ImageHeight": String(this.data.printHeight), // 图片高（单位mm）
        "Speed": String(this.data.printSpeed),
      }]

      this.toast('正在打印...', 'loading')

      // 调用打印SDK
      bleToothManage.doPrintImage(
        this.data.printCanvasCtx,
        PageImageObject,
        (res: any) => {
          console.log('打印回调', res)
          
          if (res.ResultCode == constants.globalResultCode.ResultCode100) {
            // 打印进度回调
            const resultValue = res.ResultValue
            console.log('打印尺寸:', resultValue.width, resultValue.height)
          } else if (res.ResultCode == constants.globalResultCode.ResultCodeSuccess) {
            // 打印完成
            this.toast('打印完成', 'success')
          } else {
            this.toast('打印失败', 'error')
          }
        }
      ).catch((error: any) => {
        console.error('打印失败', error)
        this.toast('打印失败', 'error')
      })
    } catch (error) {
      console.error('生成图片失败', error)
      this.toast('生成图片失败', 'error')
    }
  },

})
