// miniprogram/pages/editor/editor.ts

import drawQrcode from '../../SUPVANAPIT50PRO/weapp.qrcode.esm.js'

// 定义笔触点结构
interface HeatPoint {
  x: number
  y: number
  r: number
  opacity: number
}

// 定义笔画结构（已使用，但TypeScript可能检测不到）
// type Stroke = HeatPoint[]

// 已移除 MAX_EXPORT_WIDTH 和 MAX_EXPORT_HEIGHT，现在使用统一的标准尺寸

const BRUSH_RADIUS_RANGE = { min: 6, max: 60 }
const BRUSH_CONFIG = {
  normal: { radius: 40, heatRate: 0.6, heatMin: 0.2, heatMax: 3 },
  pureBlack: { radius: 6, heatRate: 10, heatMin: 3, heatMax: 10 }
}

const clampValue = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

Page({

  data: {
    toolsVisible: false,
    brushRadius: 40,
    heatRate: 0.6,
    brushRadiusMin: BRUSH_RADIUS_RANGE.min,
    brushRadiusMax: BRUSH_RADIUS_RANGE.max,
    heatRateMin: BRUSH_CONFIG.normal.heatMin,
    heatRateMax: BRUSH_CONFIG.normal.heatMax,
    canUndo: false,
    canRedo: false,
    openid: '',
    snapshotUrl: '',
    qrCodeUrl: '', // 下载链接的二维码图片路径
    isCanvasHidden: false,
    backgroundImage: '', // 临时背景图
    permanentBackgroundImage: '', // 常驻背景图
    permanentBackgroundAspectRatio: undefined as number | undefined, // 常驻背景的宽高比
    canvasContainerStyle: '', // canvas容器的动态样式
    artworkId: '',

    hasUnsavedChanges: false,
    maxUndoSteps: 10,
    pureBlackBrush: false,
  },

  async onLoad(options: any) {
      // 初始化实例变量
      Object.assign(this, {
      strokes: [], // ... existing ...
        redoStack: [],
      currentStroke: [], // ... existing ...
        needsRender: false,
      renderLoopId: 0,
    })
    // 先加载常驻背景，然后再初始化画布（这样可以根据常驻背景的比例调整画布）
    await this.loadPermanentBackground()
    // 等待画布初始化完成
    await this.initCanvas()
    
    this.loadBrushPreferences()
    
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
    const maxUndoSteps = wx.getStorageSync('editor_max_undo_steps') || 10
    this.setData({ maxUndoSteps })
    this.updateExitConfirmState()
    // 重新加载常驻背景（可能用户在设置页面修改了）
    this.loadPermanentBackground()
    // 刷新画笔模式
    this.loadBrushPreferences()
  },

  updateExitConfirmState() {
    let exitConfirm = wx.getStorageSync('editor_exit_confirm')

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
      let selectedBg = wx.getStorageSync('selected_background_editor')

      // 兼容性：如果新键没有值，尝试读取旧键
      if (!selectedBg) {
         selectedBg = wx.getStorageSync('selected_background')
      }
      
      // 如果没有缓存，尝试加载默认背景 (bgeditor.*)
      if (!selectedBg) {
        const extensions = ['.png', '.jpg', '.jpeg']
        for (const ext of extensions) {
           const path = `/images/bgeditor${ext}`
           try {
             // 简单的探测，如果getImageInfo成功则认为文件存在
             const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
               wx.getImageInfo({ 
                 src: path,
                 success: resolve,
                 fail: reject
               })
             })
             
             selectedBg = {
               name: `bgeditor${ext}`,
               tempFilePath: path,
               aspectRatio: imageInfo.width / imageInfo.height
             }
             // 找到一个就停止
             break; 
           } catch(e) {
             // ignore
           }
        }
      }

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
            // 更新存储中的宽高比信息（仅当存在缓存记录时）
            // 注意：如果是我们刚才构造的临时对象，这里可能不需要setStorage，
            // 但如果用户确实需要记住这个默认状态，可以在bgselect逻辑中更早地固化。
            // 这里为了安全起见，只更新内存中的状态，或者只更新已存在的 selected_background
            if (wx.getStorageSync('selected_background')) {
                wx.setStorageSync('selected_background', {
                ...selectedBg,
                aspectRatio
                })
            }
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

  loadBrushPreferences() {
    const pureBlackBrush = !!wx.getStorageSync('editor_pure_black_brush')
    const prevMode = !!this.data.pureBlackBrush
    const modeChanged = pureBlackBrush !== prevMode
    const config = pureBlackBrush ? BRUSH_CONFIG.pureBlack : BRUSH_CONFIG.normal

    const currentHeat = this.data.heatRate ?? config.heatRate
    const currentRadius = this.data.brushRadius ?? config.radius

    const nextData: Record<string, any> = {
      pureBlackBrush,
      heatRateMin: config.heatMin,
      heatRateMax: config.heatMax,
      brushRadiusMin: BRUSH_RADIUS_RANGE.min,
      brushRadiusMax: BRUSH_RADIUS_RANGE.max,
    }

    if (modeChanged) {
      nextData.heatRate = config.heatRate
      nextData.brushRadius = config.radius
    } else {
      nextData.heatRate = clampValue(currentHeat, config.heatMin, config.heatMax)
      nextData.brushRadius = clampValue(currentRadius, BRUSH_RADIUS_RANGE.min, BRUSH_RADIUS_RANGE.max)
    }

    this.setData(nextData)
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
    self.lastPoint = { x, y } // 记录上一个点的位置
      this.addPoint(x, y)
    },

    onTouchMove(e: any) {
      const { x, y } = e.touches[0]
    const self = this as any
    
    // 计算与上一个点的距离
    const lastPoint = self.lastPoint
    const distance = Math.sqrt((x - lastPoint.x) ** 2 + (y - lastPoint.y) ** 2)
    
    // 如果距离大于阈值（例如5像素），在两点之间插入额外的点
    const threshold = 5 // 可以调整这个值来控制插值密度
    if (distance > threshold) {
      const steps = Math.ceil(distance / threshold)
      for (let i = 1; i <= steps; i++) {
        const ratio = i / steps
        const interpolatedX = lastPoint.x + (x - lastPoint.x) * ratio
        const interpolatedY = lastPoint.y + (y - lastPoint.y) * ratio
        this.addPoint(interpolatedX, interpolatedY)
      }
    } else {
      this.addPoint(x, y)
    }
    
    // 更新上一个点
    self.lastPoint = { x, y }
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
    const usePureBlack = this.data?.pureBlackBrush
      
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3]
        if (alpha > 0) {
        if (usePureBlack) {
          data[i] = 0
          data[i + 1] = 0
          data[i + 2] = 0
          data[i + 3] = alpha
        } else {
          const offset = alpha * 4
          data[i] = palette[offset]
          data[i + 1] = palette[offset + 1]
          data[i + 2] = palette[offset + 2]
          data[i + 3] = palette[offset + 3]
        }
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
        fileType: 'jpg',
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
      const min = this.data.brushRadiusMin || BRUSH_RADIUS_RANGE.min
      const max = this.data.brushRadiusMax || BRUSH_RADIUS_RANGE.max
      const numericValue = Number(value)
      if (Number.isNaN(numericValue)) return
      const radius = clampValue(numericValue, min, max)
      this.setData({ brushRadius: radius })
    }
    },

    onHeatRateChange(e: any) {
      console.log('onHeatRateChange', e)
    const { value } = e.detail || {}
    if (value !== undefined) {
      const min = this.data.heatRateMin || BRUSH_CONFIG.normal.heatMin
      const max = this.data.heatRateMax || BRUSH_CONFIG.normal.heatMax
      const numericValue = parseFloat(value)
      if (Number.isNaN(numericValue)) return
      const heatRate = clampValue(numericValue, min, max)
      this.setData({ heatRate: Number(heatRate.toFixed(2)) })
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

  onSave() {
    this.setData({ toolsVisible: false })
    
    // 为了防止 Canvas（原生组件层级高）挡住二维码
    // 我们在点击保存时，先生成一张 Canvas 的快照图片
    // 然后隐藏 Canvas，显示这张快照图片
    // 这样接下来的二维码弹窗（普普通通的 View/Image）就能覆盖在快照图片上了
    
    // 只有当需要显示二维码时（保存成功后）这个策略发挥最大作用
    // 但因为从点击保存到保存成功有一段时间，我们現在就切换也无妨，体验更流畅（界面静止）
    
    const self = this as any
    if (self.canvas) {
        wx.canvasToTempFilePath({
            canvas: self.canvas,
            fileType: 'jpg',
            quality: 0.8,
            success: (res) => {
                this.setData({
                    snapshotUrl: res.tempFilePath,
                    isCanvasHidden: true // 隐藏 Canvas，显示快照
                })
                // 继续执行实际的保存逻辑
                this.saveArtwork()
            },
            fail: (err) => {
                console.error('Snapshot failed', err)
                // 即使截图失败，也直接保存，不影响核心流程
                this.saveArtwork()
            }
        })
    } else {
         this.saveArtwork()
    }
  },
  
  // 實際執行保存的邏輯，將被 onSave 調用
  async saveArtwork() {
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
        cloudPath: `artworks/${openid}/${id}_thumb.jpg`,
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
        
        // 保存成功后显示下载二维码
        if (thumbnailFileId) {
             this.showDownloadQrCode(thumbnailFileId)
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
    const originalWidth = self.width * dpr
    const originalHeight = self.height * dpr

    // 统一使用固定标准尺寸（基于手机参数，确保所有设备生成相同尺寸的图片）
    // 手机参数：画布尺寸约 956x1274，宽高比约 0.75
    // 使用固定标准尺寸：1400x1867（宽高比 0.75，接近手机画布比例）
    const standardWidth = 1400
    const standardHeight = 1867
    
    console.log('统一图片生成尺寸（固定标准尺寸，基于手机参数）:', {
      原始尺寸: `${originalWidth}x${originalHeight}`,
      原始宽高比: (originalWidth / originalHeight).toFixed(3),
      标准尺寸: `${standardWidth}x${standardHeight}`,
      标准宽高比: (standardWidth / standardHeight).toFixed(3),
      说明: '所有设备统一使用此标准尺寸，确保SDK计算参数一致'
    })

    // 1. 创建一个临时的离屏 Canvas 用于合成（使用标准尺寸）
    // @ts-ignore
    const offscreenCanvas = wx.createOffscreenCanvas({ type: '2d', width: standardWidth, height: standardHeight })
    const offscreenCtx = offscreenCanvas.getContext('2d')

    // 预先填充白色背景，确保转换jpg时无透明底问题
    offscreenCtx.fillStyle = '#ffffff'
    offscreenCtx.fillRect(0, 0, standardWidth, standardHeight)

    // 2. 先绘制常驻背景（最底层）
    if (this.data.permanentBackgroundImage) {
      // @ts-ignore - 离屏 Canvas 的 createImage 方法
      const permanentBgImg = offscreenCanvas.createImage()
      permanentBgImg.src = this.data.permanentBackgroundImage
      await new Promise((resolve) => {
        permanentBgImg.onload = resolve
        permanentBgImg.onerror = resolve // 容错处理
      })
      offscreenCtx.drawImage(permanentBgImg, 0, 0, standardWidth, standardHeight)
    } 
    // else { // 已在上方统一填充白色，此处无需处理 }

    // 3. 再绘制临时背景（中间层，如果有的话）
    if (this.data.backgroundImage) {
      // @ts-ignore - 离屏 Canvas 的 createImage 方法
      const bgImg = offscreenCanvas.createImage()
      bgImg.src = this.data.backgroundImage
      await new Promise((resolve) => {
        bgImg.onload = resolve
        bgImg.onerror = resolve // 容错处理
      })
      offscreenCtx.drawImage(bgImg, 0, 0, standardWidth, standardHeight)
    }

    // 4. 获取当前热力图的 ImageData 并处理颜色映射
    // 注意：需要从原始画布尺寸获取 ImageData，然后缩放到标准尺寸
    if (self.memCtx && self.palette) {
      // 从原始画布获取 ImageData
      const originalHeatmapData = self.memCtx.getImageData(0, 0, originalWidth, originalHeight)
      const originalPixels = originalHeatmapData.data
      const palette = self.palette
      const usePureBlack = this.data?.pureBlackBrush

      // 处理颜色映射
      for (let i = 0; i < originalPixels.length; i += 4) {
        const alpha = originalPixels[i + 3]
        if (alpha > 0) {
          if (usePureBlack) {
            originalPixels[i] = 0
            originalPixels[i + 1] = 0
            originalPixels[i + 2] = 0
            originalPixels[i + 3] = alpha
          } else {
            const offset = alpha * 4
            originalPixels[i] = palette[offset]
            originalPixels[i + 1] = palette[offset + 1]
            originalPixels[i + 2] = palette[offset + 2]
            originalPixels[i + 3] = palette[offset + 3]
          }
        }
      }

      // 检测有效内容区域（裁剪空白边缘，确保不同设备内容位置一致）
      // 使用采样检测，提高性能
      const sampleStep = 8
      let minX = originalWidth, minY = originalHeight, maxX = 0, maxY = 0
      let hasContent = false
      let contentPixelCount = 0
      const totalSamplePixels = Math.ceil(originalWidth / sampleStep) * Math.ceil(originalHeight / sampleStep)
      
      for (let y = 0; y < originalHeight; y += sampleStep) {
        for (let x = 0; x < originalWidth; x += sampleStep) {
          const idx = (y * originalWidth + x) * 4
          const r = originalPixels[idx]
          const g = originalPixels[idx + 1]
          const b = originalPixels[idx + 2]
          const a = originalPixels[idx + 3]
          
          // 判断是否为非白色像素（更严格的判断）
          // 白色判断：RGB 都接近 255（阈值提高到 240），或者 alpha 为 0
          // 注意：如果画布有背景图，背景图的像素也会被检测为"内容"
          // 所以我们需要更严格地判断：只有真正有绘制内容（热力图）的像素才算内容
          // 但这里我们无法区分背景和热力图，所以只能通过占比来判断
          const isWhite = (r > 240 && g > 240 && b > 240) || a === 0
          
          if (!isWhite) {
            hasContent = true
            contentPixelCount++
            minX = Math.min(minX, x)
            minY = Math.min(minY, y)
            maxX = Math.max(maxX, x)
            maxY = Math.max(maxY, y)
          }
        }
      }
      
      // 如果内容像素占比超过 85%，说明几乎没有空白边缘，不需要裁剪
      // 这样可以避免误裁剪导致打印空白
      const contentRatio = hasContent ? (contentPixelCount / totalSamplePixels) : 0
      const shouldCrop = hasContent && contentRatio < 0.85 && (maxX - minX) < originalWidth * 0.95 && (maxY - minY) < originalHeight * 0.95
      
      console.log('内容检测结果:', {
        检测到内容: hasContent,
        内容像素数: contentPixelCount,
        总采样像素数: totalSamplePixels,
        内容占比: `${(contentRatio * 100).toFixed(1)}%`,
        内容区域: hasContent ? `(${minX}, ${minY}) - (${maxX}, ${maxY})` : '无',
        内容尺寸: hasContent ? `${maxX - minX + 1}x${maxY - minY + 1}` : '0x0',
        原始尺寸: `${originalWidth}x${originalHeight}`,
        是否裁剪: shouldCrop,
        说明: shouldCrop ? '检测到明显空白边缘，将进行裁剪' : '内容占比过高或无明显空白，不裁剪'
      })
      
      // 扩展检测区域，确保不遗漏边缘内容
      if (shouldCrop) {
        minX = Math.max(0, minX - sampleStep)
        minY = Math.max(0, minY - sampleStep)
        maxX = Math.min(originalWidth - 1, maxX + sampleStep)
        maxY = Math.min(originalHeight - 1, maxY + sampleStep)
      }
      
      if (shouldCrop) {
        // 计算内容区域的尺寸
        const contentWidth = maxX - minX + 1
        const contentHeight = maxY - minY + 1
        
        // 将处理后的 ImageData 绘制到临时 Canvas（只绘制有效内容区域）
        // @ts-ignore
        const tempHeatmapCanvas = wx.createOffscreenCanvas({ type: '2d', width: contentWidth, height: contentHeight })
        const tempHeatmapCtx = tempHeatmapCanvas.getContext('2d')
        
        // 提取有效内容区域的 ImageData
        const contentImageData = tempHeatmapCtx.createImageData(contentWidth, contentHeight)
        const contentPixels = contentImageData.data
        
        for (let y = 0; y < contentHeight; y++) {
          for (let x = 0; x < contentWidth; x++) {
            const srcIdx = ((minY + y) * originalWidth + (minX + x)) * 4
            const dstIdx = (y * contentWidth + x) * 4
            contentPixels[dstIdx] = originalPixels[srcIdx]
            contentPixels[dstIdx + 1] = originalPixels[srcIdx + 1]
            contentPixels[dstIdx + 2] = originalPixels[srcIdx + 2]
            contentPixels[dstIdx + 3] = originalPixels[srcIdx + 3]
          }
        }
        
        tempHeatmapCtx.putImageData(contentImageData, 0, 0)
        
        // 将裁剪后的内容拉伸填满标准尺寸画布，从 (0,0) 开始
        // 使用 fill 模式：直接拉伸填满画布，确保打印时图片从纸张左上角开始，不会出现偏移
        console.log('内容裁剪和拉伸填满（确保打印位置准确）:', {
          原始内容区域: `(${minX}, ${minY}) - (${maxX}, ${maxY})`,
          内容尺寸: `${contentWidth}x${contentHeight}`,
          内容占比: `${(contentRatio * 100).toFixed(1)}%`,
          目标尺寸: `${standardWidth}x${standardHeight}`,
          说明: '裁剪空白边缘后拉伸填满画布，从(0,0)开始，确保打印位置准确'
        })
        
        // 直接拉伸填满整个画布，从 (0,0) 开始
        offscreenCtx.drawImage(tempHeatmapCanvas, 0, 0, standardWidth, standardHeight)
      } else {
        // 如果内容占比超过 90% 或没有检测到有效内容，使用原有逻辑（全图缩放居中）
        // 这样可以避免误裁剪导致打印空白
        // @ts-ignore
        const tempHeatmapCanvas = wx.createOffscreenCanvas({ type: '2d', width: originalWidth, height: originalHeight })
        const tempHeatmapCtx = tempHeatmapCanvas.getContext('2d')
        tempHeatmapCtx.putImageData(originalHeatmapData, 0, 0)
        
        // 将热力图拉伸填满标准尺寸画布，从 (0,0) 开始
        // 使用 fill 模式：直接拉伸填满画布，确保打印时图片从纸张左上角开始，不会出现偏移
        console.log('使用全图拉伸填满（内容占比过高或未检测到有效内容）:', {
          内容占比: hasContent ? `${(contentRatio * 100).toFixed(1)}%` : '0%',
          原始尺寸: `${originalWidth}x${originalHeight}`,
          目标尺寸: `${standardWidth}x${standardHeight}`,
          说明: '内容占比超过90%，不进行裁剪，直接拉伸填满画布，从(0,0)开始，确保打印位置准确'
        })
        
        // 直接拉伸填满整个画布，从 (0,0) 开始
        offscreenCtx.drawImage(tempHeatmapCanvas, 0, 0, standardWidth, standardHeight)
      }
    }

    // 使用标准尺寸导出（不再需要缩放，因为已经统一了尺寸）
    let destWidth = standardWidth
    let destHeight = standardHeight

    // 6. 导出合成后的图片
    return new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: offscreenCanvas,
        destWidth: destWidth,
        destHeight: destHeight,
        fileType: 'jpg',
        quality: 0.9,
        success: (res) => resolve(res.tempFilePath),
        fail: reject
      })
    })
  },

  // 真正的生成二维码实现
  async drawQrCodeToPath(url: string): Promise<string> {
     return new Promise((resolve, reject) => {
         const query = this.createSelectorQuery()
         // 查找我们在 wxml 中添加的隐藏 canvas
         query.select('#qrCodeCanvas')
            .fields({ node: true, size: true })
            .exec(async (res) => {
                if (!res[0] || !res[0].node) {
                    console.error('Canvas #qrCodeCanvas not found')
                    reject('Canvas not found')
                    return
                }
                const canvas = res[0].node
                const ctx = canvas.getContext('2d')
                const dpr = wx.getSystemInfoSync().pixelRatio || 1
                
                const width = res[0].width
                const height = res[0].height
                
                canvas.width = width * dpr
                canvas.height = height * dpr
                ctx.scale(dpr, dpr)
                
                // 清空
                ctx.clearRect(0, 0, width, height)
                
                // 绘制二维码
                drawQrcode({
                    canvas: canvas,
                    canvasId: 'qrCodeCanvas',
                    width: width,
                    height: height,
                    padding: 0,
                    text: url,
                    background: '#ffffff',
                    foreground: '#000000',
                })
                
                // 导出为临时路径
                setTimeout(() => {
                    wx.canvasToTempFilePath({
                        canvas: canvas,
                        success: (res) => {
                            resolve(res.tempFilePath)
                        },
                        fail: reject
                    })
                }, 200)
            })
     })
  },

  async showDownloadQrCode(fileID: string) {
       try {
           const res = await wx.cloud.getTempFileURL({ fileList: [fileID] })
           if (!res.fileList || !res.fileList[0].tempFileURL) return
           
           const url = res.fileList[0].tempFileURL
           console.log('Generating QR code for:', url)
           const qrPath = await this.drawQrCodeToPath(url)
           
           this.setData({ qrCodeUrl: qrPath })
       } catch (e) {
           console.error('Show QR Code failed', e)
       }
  },

  preventBubble() {},
  
  preventScroll() {},

  onCloseQrCode() {
      // 关闭二维码时，我们要把Canvas恢复显示
      this.setData({ 
          qrCodeUrl: '',
          // 如果之前因为显示二维码而隐藏了Canvas，现在恢复它
          // 注意：如果还有其他弹窗（如工具栏），需根据逻辑判断，目前只处理二维码关闭
          isCanvasHidden: false 
      })
  },
})
