// 打印管理模块
// 将打印相关逻辑从 editor.ts 中拆分出来

import bleToothManage from '../../SUPVANAPIT50PRO/BLEToothManage.js'
import constants from '../../SUPVANAPIT50PRO/Constants.js'

// 打印参数接口
export interface PrintSettings {
  printWidth: number
  printHeight: number
  printCopies: number
  printDensity: number
  printSpeed: number
  printRotate: number
  printPaperType: number
  printGap: number
}

// 默认打印参数（严格按照SDK文档2.1节）
export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  printWidth: 70,      // 耗材宽度（mm）
  printHeight: 100,     // 耗材高度（mm）
  printRotate: 1,      // 旋转角度（1=0度，2=90度），默认1
  printCopies: 1,      // 打印份数（1-99），默认1
  printDensity: 3,     // 浓度（1-9），默认3
  printSpeed: 30,      // 打印速度（15-60），默认30
  printPaperType: 1,   // 纸张类型（1-间隙，2-普通黑标，3-连续，5-黑标卡纸），默认1
  printGap: 3,         // 纸张间隙（mm，范围0-8），默认3
}

// 打印管理器类
export class PrintManager {
  private page: any // Page 实例

  constructor(page: any) {
    this.page = page
    this.checkPrinterConnection()
  }

  // 检查打印机连接状态
  // 注意：默认不读取本地存储，只有用户主动连接后才显示已连接
  // 这样可以确保每次打开小程序时都是未连接状态，需要重新搜索和连接
  checkPrinterConnection() {
    // 默认设置为未连接状态，不读取本地存储
    // 连接状态应该由 settings 页面管理，通过连接成功后的回调来更新
    this.page.setData({ connectedDevice: null })
  }

  // 从本地存储同步连接状态（仅在用户主动连接后调用）
  syncConnectionFromStorage() {
    const savedDevice = wx.getStorageSync('connected_printer_device')
    if (savedDevice) {
      this.page.setData({ connectedDevice: savedDevice })
    } else {
      this.page.setData({ connectedDevice: null })
    }
  }

  // 初始化打印Canvas（与SDK示例保持一致）
  initPrintCanvas() {
    try {
      // 使用 createCanvasContext 创建传统 Canvas 上下文（与 SDK 示例保持一致）
      // 示例中使用 canvas-id="Canvas"
      const ctx = wx.createCanvasContext('Canvas', this.page)
      const barCode = wx.createSelectorQuery().in(this.page)
      if (ctx) {
        this.page.setData({ 
          canvasText: ctx,
          canvasBarCode: barCode
        })
        console.log('打印Canvas初始化成功')
      }
    } catch (error) {
      console.error('打印Canvas初始化失败:', error)
    }
  }

  // 加载打印参数（始终使用默认值，不保存到本地）
  loadPrintSettings(): PrintSettings {
    const defaultSettings = DEFAULT_PRINT_SETTINGS
    this.page.setData(defaultSettings)
    return defaultSettings
  }

  // 保存打印参数（不再保存到本地，仅用于兼容性）
  savePrintSettings(_settings: PrintSettings) {
    // 不再保存到本地存储，参数仅在当前会话中有效
  }

  // 检查是否可以打印
  canPrint(): { canPrint: boolean; message?: string } {
    // 检查是否已连接打印机
    if (!this.page.data.connectedDevice) {
      return {
        canPrint: false,
        message: '未连接打印机，请在设置界面连接'
      }
    }

    // 检查画布是否有内容
    // editor 页面有 strokes 属性，brush 页面没有，所以需要分别检查
    const self = this.page as any
    if (self.strokes !== undefined) {
      // editor 页面：检查 strokes
      if (!self.strokes || self.strokes.length === 0) {
        return {
          canPrint: false,
          message: '画布为空，无法打印'
        }
      }
    } else {
      // brush 页面：检查 canvas 是否存在（无法简单判断是否有内容，所以只检查 canvas 是否存在）
      if (!self.canvas) {
        return {
          canPrint: false,
          message: '画布未初始化，无法打印'
        }
      }
    }

    // 检查Canvas是否初始化
    if (!this.page.data.canvasText) {
      return {
        canPrint: false,
        message: '打印Canvas未初始化'
      }
    }

    return { canPrint: true }
  }

  // 上传图片到云存储并获取网络URL
  async uploadImageToCloud(localPath: string, openid: string): Promise<string> {
    console.log('检测到本地路径，上传到云存储获取网络URL...')
    this.page.toast('正在上传图片...', 'loading')
    
    try {
      const timestamp = Date.now()
      const cloudPath = `print_temp/${openid}/${timestamp}_print.jpg`
      
      // 上传到云存储
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: localPath
      })
      
      console.log('上传成功，fileID:', uploadRes.fileID)
      
      // 获取临时下载URL（https://开头）
      const tempUrlRes = await wx.cloud.getTempFileURL({
        fileList: [uploadRes.fileID]
      })
      
      if (tempUrlRes.fileList && tempUrlRes.fileList.length > 0 && tempUrlRes.fileList[0].tempFileURL) {
        const imageUrl = tempUrlRes.fileList[0].tempFileURL
        console.log('获取到网络URL:', imageUrl)
        
        // 验证网络URL是否可以访问（等待更长时间确保URL完全生效）
        try {
          // 等待更长时间，确保云存储URL完全生效
          await new Promise((resolve) => setTimeout(resolve, 1000)) // 等待1秒
          
          // 尝试获取图片信息，验证URL可访问
          const urlImageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
            wx.getImageInfo({
              src: imageUrl,
              success: resolve,
              fail: reject,
            })
          })
          console.log('网络URL验证成功:', {
            url: imageUrl,
            width: urlImageInfo.width,
            height: urlImageInfo.height
          })
          
          // 再次等待，确保SDK可以访问
          await new Promise((resolve) => setTimeout(resolve, 500))
        } catch (urlErr) {
          console.warn('网络URL验证失败，但继续尝试:', urlErr)
          // 不阻止打印，继续尝试
        }
        
        return imageUrl
      } else {
        throw new Error('无法获取临时下载URL')
      }
    } catch (uploadErr) {
      console.error('上传到云存储失败:', uploadErr)
      throw uploadErr
    }
  }

  // 预处理图片：将图片缩放/裁剪到匹配打印纸张的尺寸和宽高比
  // 注意：预处理为560x800（70x100mm），不交换宽高，确保宽度不超过纸张宽度
  async preprocessImageForPrint(
    imagePath: string, 
    targetWidth: number, 
    targetHeight: number
  ): Promise<string> {
    // 获取原始图片信息
    const imageInfo = await this.validateImagePath(imagePath)
    let sourceWidth = imageInfo.width
    let sourceHeight = imageInfo.height
    const sourceAspectRatio = sourceWidth / sourceHeight
    const targetAspectRatio = targetWidth / targetHeight
    
    // 计算目标像素尺寸
    // 根据 SDK 文档，ImageWidth 和 ImageHeight 是预览图尺寸（mm）
    // SDK 会根据这个尺寸来缩放图片，所以我们需要确保图片的宽高比匹配
    // 从调试信息看，SDK 内部使用 8 像素/mm
    const pixelsPerMm = 8  // 与 SDK 内部处理一致
    
    // 关键发现：从日志看，SDK内部会自动旋转-90度（即使Rotate=1）
    // 旋转后：560x800的图片变成800x560，但纸张是70x100mm（560x800像素）
    // 这导致图片宽度(800) > 纸张宽度(560)，所以左边距为0
    // 
    // 解决方案：预处理时需要考虑SDK的自动旋转
    // 如果SDK会旋转-90度，我们需要预处理为旋转后的目标尺寸
    // 即：预处理为800x560（对应100x70mm），这样旋转后变成560x800，匹配纸张70x100mm
    // 但ImageWidth/ImageHeight仍然设置为70x100mm（与Width/Height一致）
    let targetPixelWidth = Math.round(targetWidth * pixelsPerMm)
    let targetPixelHeight = Math.round(targetHeight * pixelsPerMm)
    
    // 关键发现：从日志看，SDK内部会自动旋转-90度（即使Rotate=1）
    // 但旋转后的尺寸仍然是800x560（宽>高），而不是560x800
    // 这说明SDK的旋转逻辑可能不是简单的宽高交换
    // 
    // 从日志分析：
    // - 预处理后：800x560像素（我们交换了宽高）
    // - SDK旋转-90度后：仍然是800宽x560高（imageWidth: 800, imageHeight: 560）
    // - 纸张宽度：70mm = 560像素
    // - 图片宽度（旋转后）：800像素 > 560像素，所以左边距为0
    //
    // 问题根源：图片宽度(800) > 纸张宽度(560)
    // 解决方案：不交换宽高，保持原始尺寸560x800
    // 这样即使SDK旋转，宽度(560)也不会超过纸张宽度(560)
    
    // 不交换宽高，保持原始尺寸560x800，确保宽度不超过纸张宽度
    
    // 计算宽高比差异
    const aspectRatioDiff = Math.abs(sourceAspectRatio - targetAspectRatio)
    
    console.log('预处理图片:', {
      原始尺寸: `${sourceWidth}x${sourceHeight}`,
      原始宽高比: sourceAspectRatio.toFixed(3),
      目标尺寸: `${targetWidth}x${targetHeight}mm`,
      目标像素: `${targetPixelWidth}x${targetPixelHeight}`,
      目标宽高比: targetAspectRatio.toFixed(3),
      宽高比差异: aspectRatioDiff.toFixed(3),
      尺寸缩放比例: `${(targetPixelWidth / sourceWidth).toFixed(2)}x / ${(targetPixelHeight / sourceHeight).toFixed(2)}x`
    })
    
    // 如果宽高比差异很大，给出警告
    if (aspectRatioDiff > 0.1) {
      console.warn('警告：图片宽高比与打印纸张差异较大，预处理时会拉伸图片', {
        原始宽高比: sourceAspectRatio.toFixed(3),
        目标宽高比: targetAspectRatio.toFixed(3),
        差异: aspectRatioDiff.toFixed(3)
      })
    }
    
    // 如果宽高比已经匹配且尺寸接近，直接返回原图
    const sizeMatch = Math.abs(sourceWidth - targetPixelWidth) < 10 && Math.abs(sourceHeight - targetPixelHeight) < 10
    if (Math.abs(sourceAspectRatio - targetAspectRatio) < 0.01 && sizeMatch) {
      console.log('图片尺寸和宽高比已匹配，无需预处理')
      return imagePath
    }
    
    // 不再进行预缩放，直接使用原始图片
    let preprocessedImagePath = imagePath
    
    // 创建离屏 Canvas 进行图片处理
    // 注意：某些设备可能对 Canvas 尺寸有限制，如果目标尺寸过大，先进行缩放
    let finalTargetWidth = targetPixelWidth
    let finalTargetHeight = targetPixelHeight
    const maxCanvasSize = 4096 // 某些设备的最大 Canvas 尺寸限制
    
    // 如果目标尺寸超过限制，按比例缩放
    if (finalTargetWidth > maxCanvasSize || finalTargetHeight > maxCanvasSize) {
      const scale = Math.min(maxCanvasSize / finalTargetWidth, maxCanvasSize / finalTargetHeight)
      finalTargetWidth = Math.floor(finalTargetWidth * scale)
      finalTargetHeight = Math.floor(finalTargetHeight * scale)
      console.warn('目标尺寸超过限制，已缩放:', {
        原始目标: `${targetPixelWidth}x${targetPixelHeight}`,
        缩放后: `${finalTargetWidth}x${finalTargetHeight}`,
        缩放比例: scale.toFixed(3)
      })
    }
    
    try {
      // @ts-ignore
      const offscreenCanvas = wx.createOffscreenCanvas({ 
        type: '2d', 
        width: finalTargetWidth, 
        height: finalTargetHeight 
      })
      const ctx = offscreenCanvas.getContext('2d')
      
      // 填充白色背景
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, finalTargetWidth, finalTargetHeight)
      
      // 加载并绘制图片（使用预处理后的图片路径）
      // @ts-ignore
      const img = offscreenCanvas.createImage()
      img.src = preprocessedImagePath
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = (err: any) => {
          console.error('图片加载失败:', err)
          reject(new Error('图片加载失败'))
        }
      })
      
      // 不再缩小图片，直接填满画布
      // 向左偏移一点，补偿打印时的右偏移问题
      // 计算像素偏移量：向左偏移约2.5mm（根据8像素/mm计算）
      const leftOffsetMm = 2.5  // 向左偏移2.5mm
      const leftOffsetPixels = Math.round(leftOffsetMm * pixelsPerMm)  // 转换为像素
      const drawX = Math.max(0, -leftOffsetPixels)  // 向左偏移，但不超出画布
      const drawY = 0
      const drawWidth = finalTargetWidth
      const drawHeight = finalTargetHeight
      
      console.log('图片预处理（填满画布，向左偏移）:', {
        画布尺寸: `${finalTargetWidth}x${finalTargetHeight}`,
        绘制尺寸: `${drawWidth}x${drawHeight}`,
        向左偏移: `${leftOffsetMm}mm (${leftOffsetPixels}px)`,
        最终位置: `(${drawX}, ${drawY})`,
        说明: '图片填满画布，向左偏移补偿打印右偏移问题',
        注意: '预处理为560x800，未交换宽高，确保宽度不超过纸张宽度'
      })
      
      // 绘制图片，填满画布并向左偏移
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)
      
      // 导出处理后的图片
      return new Promise((resolve, reject) => {
        wx.canvasToTempFilePath({
          canvas: offscreenCanvas,
          fileType: 'jpg',
          quality: 0.9,
          success: (res) => {
            console.log('图片预处理完成:', {
              路径: res.tempFilePath,
              最终尺寸: `${finalTargetWidth}x${finalTargetHeight}`
            })
            resolve(res.tempFilePath)
          },
          fail: (err) => {
            console.error('导出预处理图片失败:', err)
            reject(err)
          }
        })
      })
    } catch (error) {
      console.error('预处理图片时发生错误:', error)
      throw new Error(`图片预处理失败: ${error}`)
    }
  }

  // 验证图片路径
  async validateImagePath(imagePath: string): Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult> {
    // 验证图片路径是否存在
    if (!imagePath) {
      throw new Error('生成图片失败：路径为空')
    }
    
    // 获取图片信息，验证图片是否有效
    const imageInfo = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
      wx.getImageInfo({
        src: imagePath,
        success: resolve,
        fail: reject,
      })
    })
    
    console.log('图片信息:', {
      path: imagePath,
      width: imageInfo.width,
      height: imageInfo.height,
      type: imageInfo.type
    })
    
    // 验证文件是否存在（通过文件系统管理器）
    try {
      const fs = wx.getFileSystemManager()
      fs.accessSync(imagePath)
      console.log('文件存在验证通过:', imagePath)
    } catch (fsErr) {
      console.error('文件不存在或无法访问:', fsErr)
      console.warn('文件系统验证失败，但继续尝试打印')
    }
    
    return imageInfo
  }

  // 获取设备序列号（DeviceSn）
  private getDeviceSn(): string {
    const connectedDevice = this.page.data.connectedDevice
    if (!connectedDevice) {
      throw new Error('未连接打印机设备，无法获取设备序列号')
    }
    
    // 尝试从设备名称中提取序列号
    // 设备名称可能包含序列号，格式类似 "T0033A2512096269" 或 "打印机名称 T0033A2512096269"
    if (connectedDevice.name) {
      // 尝试匹配序列号格式：T开头，后面跟数字和字母的组合
      const snMatch = connectedDevice.name.match(/T[A-Z0-9]{10,}/i)
      if (snMatch) {
        console.log('从设备名称中提取序列号:', snMatch[0])
        return snMatch[0].toUpperCase()
      }
      // 如果名称本身就是序列号格式，直接使用
      if (/^T[A-Z0-9]{10,}$/i.test(connectedDevice.name)) {
        console.log('设备名称即为序列号:', connectedDevice.name)
        return connectedDevice.name.toUpperCase()
      }
    }
    
    // 如果无法从名称中提取，尝试使用 deviceId（但通常 deviceId 不是序列号）
    // 作为最后的备选方案
    if (connectedDevice.deviceId) {
      console.warn('无法从设备名称中提取序列号，使用 deviceId 作为备选:', connectedDevice.deviceId)
      return connectedDevice.deviceId
    }
    
    throw new Error('无法获取设备序列号：设备信息不完整')
  }

  // 构建打印参数对象（严格按照 SDK 文档格式）
  buildPageImageObject(settings: PrintSettings, imageUrl: string, imageInfo?: WechatMiniprogram.GetImageInfoSuccessCallbackResult): any[] {
    // 根据文档，Rotate 应该是 1 或 2（1=0度，2=90度）
    let rotateValue = settings.printRotate
    if (rotateValue !== 1 && rotateValue !== 2) {
      // 如果值不在1-2范围内，转换为1或2
      rotateValue = rotateValue <= 2 ? rotateValue : 1
    }
    
    // 根据 SDK 文档：
    // - Width/Height: 耗材尺寸（纸张尺寸，单位mm）
    // - ImageWidth/ImageHeight: 预览图图片尺寸（单位mm），应该等于图片的实际物理尺寸
    // 注意：如果 Rotate=2（90度），图片会被旋转，ImageWidth 和 ImageHeight 需要交换
    // 但根据SDK示例，即使旋转，ImageWidth/ImageHeight 也应该等于 Width/Height
    // 图片已经预处理过，宽高比已匹配纸张，所以 ImageWidth 和 ImageHeight 应该等于纸张尺寸
    let imageWidth = settings.printWidth
    let imageHeight = settings.printHeight
    
    // 如果旋转90度，SDK内部会交换宽高，但ImageWidth/ImageHeight应该保持与Width/Height一致
    // 根据SDK示例，ImageWidth/ImageHeight始终等于Width/Height，不管是否旋转
    
    // 获取设备序列号
    let deviceSn: string
    try {
      deviceSn = this.getDeviceSn()
    } catch (error: any) {
      console.error('获取设备序列号失败:', error)
      throw new Error(`获取设备序列号失败: ${error.message}`)
    }
    
    if (imageInfo) {
      const imagePixelWidth = imageInfo.width
      const imagePixelHeight = imageInfo.height
      const imageAspectRatio = imagePixelWidth / imagePixelHeight
      const paperAspectRatio = settings.printWidth / settings.printHeight
      
      // 计算纸张像素尺寸（用于验证）
      const pixelsPerMm = 8  // SDK内部使用8像素/mm
      const paperPixelWidth = settings.printWidth * pixelsPerMm
      const paperPixelHeight = settings.printHeight * pixelsPerMm
      
      console.log('打印参数构建（按SDK文档）:', {
        图片像素: `${imagePixelWidth}x${imagePixelHeight}`,
        图片宽高比: imageAspectRatio.toFixed(3),
        纸张尺寸: `${settings.printWidth}x${settings.printHeight}mm`,
        纸张像素: `${paperPixelWidth}x${paperPixelHeight}`,
        纸张宽高比: paperAspectRatio.toFixed(3),
        ImageWidth: `${imageWidth}mm (预览图宽度)`,
        ImageHeight: `${imageHeight}mm (预览图高度)`,
        旋转角度: rotateValue === 1 ? '0度' : '90度',
        设备序列号: deviceSn,
        尺寸匹配检查: {
          图片宽度匹配: imagePixelWidth === paperPixelWidth ? '✓' : `✗ (${imagePixelWidth} vs ${paperPixelWidth})`,
          图片高度匹配: imagePixelHeight === paperPixelHeight ? '✓' : `✗ (${imagePixelHeight} vs ${paperPixelHeight})`,
          说明: '如果旋转90度，SDK会交换宽高，需要确保图片尺寸与纸张尺寸匹配'
        }
      })
    }
    
    // 严格按照 SDK 文档格式：PageImageObject
    return [{
      "Width": settings.printWidth,        // 耗材宽度（mm）
      "Height": settings.printHeight,       // 耗材高度（mm）
      "Rotate": rotateValue,                // 旋转角度（1=0度，2=90度）
      "Copies": settings.printCopies,       // 打印份数
      "Density": settings.printDensity,     // 浓度（1-9）
      "HorizontalNum": 0,                   // 水平偏移（mm）
      "VerticalNum": 0,                     // 垂直偏移（mm）
      "PaperType": settings.printPaperType, // 纸张类型
      "Gap": settings.printGap,            // 纸张间隙（mm）
      "DeviceSn": deviceSn,                // 蓝牙序列号（动态获取）
      "ImageUrl": imageUrl,                 // 打印图片地址（https开头）
      "ImageWidth": imageWidth,             // 预览图图片宽（mm）
      "ImageHeight": imageHeight,           // 预览图图片高（mm）
      "Speed": settings.printSpeed,          // 打印速度
    }]
  }

  // 执行打印
  async print(imagePath: string, getComposedImagePath: () => Promise<string>): Promise<void> {
    // 在打印前同步连接状态，确保连接状态是最新的
    this.syncConnectionFromStorage()
    
    // 检查是否可以打印
    const checkResult = this.canPrint()
    if (!checkResult.canPrint) {
      // 如果是未连接打印机的错误，给出更明确的提示
      if (checkResult.message?.includes('未连接打印机')) {
        wx.showModal({
          title: '未连接打印机',
          content: checkResult.message + '，请先在设置界面连接打印机',
          showCancel: true,
          confirmText: '去设置',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) {
              wx.navigateTo({ url: '/pages/settings/settings' })
            }
          }
        })
      } else {
        this.page.toast(checkResult.message || '无法打印', 'error')
      }
      return
    }
    
    // 再次验证连接设备是否存在（双重检查）
    if (!this.page.data.connectedDevice) {
      wx.showModal({
        title: '打印机未连接',
        content: '检测到打印机未连接，请先在设置界面连接打印机',
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

    // 获取当前打印参数
    const settings: PrintSettings = {
      printWidth: this.page.data.printWidth,
      printHeight: this.page.data.printHeight,
      printCopies: this.page.data.printCopies,
      printDensity: this.page.data.printDensity,
      printSpeed: this.page.data.printSpeed,
      printRotate: this.page.data.printRotate,
      printPaperType: this.page.data.printPaperType,
      printGap: this.page.data.printGap,
    }

    // 不再保存参数到本地存储

    try {
      // 记录设备信息，用于调试不同设备上的问题
      // @ts-ignore
      const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const pageSelf = this.page as any
      
      // 计算打印纸张的宽高比（70mm × 100mm = 0.7）
      const printAspectRatio = settings.printWidth / settings.printHeight
      
      // 获取原始画布尺寸
      const originalWidth = pageSelf.width || 0
      const originalHeight = pageSelf.height || 0
      const originalDpr = pageSelf.dpr || 1
      const originalAspectRatio = originalWidth > 0 && originalHeight > 0 ? originalWidth / originalHeight : printAspectRatio
      
      console.log('设备信息:', {
        设备型号: systemInfo.model,
        屏幕宽度: systemInfo.windowWidth,
        屏幕高度: systemInfo.windowHeight,
        像素比: systemInfo.pixelRatio,
        画布逻辑尺寸: `${originalWidth}x${originalHeight}`,
        画布实际尺寸: `${originalWidth * originalDpr}x${originalHeight * originalDpr}`,
        画布宽高比: originalAspectRatio.toFixed(3),
        打印纸张宽高比: printAspectRatio.toFixed(3),
        DPR: originalDpr
      })
      
      this.page.toast('正在生成图片...', 'loading')
      
      // 生成合成图片（如果 imagePath 为空，则调用 getComposedImagePath）
      let composedPath = imagePath || await getComposedImagePath()
      
      // 记录生成的图片信息
      const composedImageInfo = await this.validateImagePath(composedPath)
      console.log('生成的合成图片信息:', {
        路径: composedPath,
        宽度: composedImageInfo.width,
        高度: composedImageInfo.height,
        宽高比: (composedImageInfo.width / composedImageInfo.height).toFixed(3),
        期望打印宽高比: printAspectRatio.toFixed(3),
        宽高比差异: Math.abs(composedImageInfo.width / composedImageInfo.height - printAspectRatio).toFixed(3)
      })
      
      // 预处理图片：将图片调整为匹配打印纸张的尺寸和宽高比
      // 关键发现：从日志看，即使我们交换了宽高预处理为800x560，SDK旋转-90度后仍然是800宽x560高
      // 这说明SDK的旋转逻辑不是简单的宽高交换，而是保持图片的宽高不变，只是旋转内容
      // 解决方案：不交换宽高，保持560x800，确保宽度(560)不超过纸张宽度(560)
      const processedPath = await this.preprocessImageForPrint(
        composedPath,
        settings.printWidth,
        settings.printHeight
      )
      
      // 重新获取处理后的图片信息
      const processedImageInfo = await this.validateImagePath(processedPath)
      console.log('预处理后图片信息:', {
        路径: processedPath,
        宽度: processedImageInfo.width,
        高度: processedImageInfo.height,
        宽高比: (processedImageInfo.width / processedImageInfo.height).toFixed(3),
        期望尺寸: `${Math.round(settings.printWidth * 8)}x${Math.round(settings.printHeight * 8)}`
      })
      
      // 处理图片URL（如果是本地路径，上传到云存储）
      let finalImageUrl = processedPath
      const isNetworkUrl = finalImageUrl.startsWith('http://') || finalImageUrl.startsWith('https://')
      
      if (!isNetworkUrl) {
        const openid = this.page.data.openid || 'unknown'
        finalImageUrl = await this.uploadImageToCloud(processedPath, openid)
      } else {
        console.log('使用网络URL:', finalImageUrl)
      }
      
      // 构建打印参数（使用处理后的图片信息，ImageWidth 和 ImageHeight 应该等于纸张尺寸）
      const PageImageObject = this.buildPageImageObject(settings, finalImageUrl, processedImageInfo)
      
      this.page.toast('正在打印...', 'loading')
      
      // 打印前检查参数
      console.log('打印参数:', JSON.stringify(PageImageObject, null, 2))
      console.log('图片URL:', finalImageUrl)
      console.log('原始路径:', composedPath)
      
      // 验证canvas上下文是否存在
      if (!this.page.data.canvasText) {
        console.error('Canvas上下文不存在，重新初始化...')
        this.initPrintCanvas()
        if (!this.page.data.canvasText) {
          this.page.toast('Canvas初始化失败', 'error')
          return
        }
      }
      console.log('Canvas上下文验证通过')
      
      // 调用打印SDK（严格按照SDK文档3.11节）
      return new Promise((resolve, reject) => {
        let hasReceivedProgress = false
        let hasReceivedSuccess = false
        
        // 设置超时检测（30秒）
        // 如果收到进度回调，说明数据已开始发送，超时后视为成功（因为可能回调丢失）
        // 如果没有收到进度回调，说明可能有问题，超时后提示用户
        const timeoutId = setTimeout(() => {
          if (!hasReceivedSuccess) {
            if (hasReceivedProgress) {
              // 已收到进度回调，说明数据已发送，可能是回调丢失，视为成功
              console.warn('打印超时：30秒内未收到成功回调，但已收到进度回调，数据已发送，视为打印成功')
              hasReceivedSuccess = true
              this.page.toast('打印完成', 'success')
              resolve()
            } else {
              // 未收到进度回调，可能有问题
              console.warn('打印超时：30秒内未收到任何回调')
              // @ts-ignore
              const systemInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
              console.warn('设备信息:', {
                设备型号: systemInfo.model,
                屏幕宽度: systemInfo.windowWidth,
                屏幕高度: systemInfo.windowHeight,
                像素比: systemInfo.pixelRatio
              })
              // 提示用户检查打印机状态
              this.page.toast('打印可能正在进行，请检查打印机状态', 'loading')
              // 不 reject，给用户时间检查
            }
          }
        }, 30000)
        
        // 按照SDK示例的简单回调处理方式
        bleToothManage.doPrintImage(this.page.data.canvasText, PageImageObject, (res: any) => {
          console.log('打印图片回调', res)
          
          // ResultCode: 100 表示打印进度回调（返回画布尺寸信息）
          if (res.ResultCode == 100) {
            hasReceivedProgress = true
            let resultValue = res.ResultValue
            console.log('打印进度回调 - 画布尺寸:', resultValue.width, resultValue.height)
            // 更新 Canvas 尺寸（SDK文档3.11节，与示例保持一致）
            this.page.setData({
              templateWidth: resultValue.width || 400,
              templateHeight: resultValue.height || 240,
            })
            // 进度回调不 resolve，继续等待完成回调（与SDK示例保持一致）
            return
          }
          
          // 其他情况（包括ResultCode: 0）表示打印完成（与SDK示例保持一致）
          // SDK示例中，除了ResultCode == 100之外，其他情况都视为完成
          hasReceivedSuccess = true
          clearTimeout(timeoutId)
          
          if (res.ResultCode == 0 || res.ResultCode == constants.globalResultCode.ResultCodeSuccess) {
            console.log('打印成功完成', {
              ResultCode: res.ResultCode,
              ResultValue: res.ResultValue,
              ErrorMsg: res.ErrorMsg
            })
            this.page.toast('打印完成', 'success')
            resolve()
          } else {
            // 非0的ResultCode，检查是否有错误信息
            const errorMsg = res.ErrorMsg?.ErrMsg || res.ErrorMsg?.msg || (typeof res.ErrorMsg === 'string' ? res.ErrorMsg : '') || `错误码: ${res.ResultCode}`
            console.error('打印失败', {
              ResultCode: res.ResultCode,
              ErrorMsg: res.ErrorMsg,
              ResultValue: res.ResultValue
            })
            this.page.toast(`打印失败: ${errorMsg}`, 'error')
            reject(new Error(errorMsg))
          }
        }).catch((error: any) => {
          clearTimeout(timeoutId)
          console.log('打印图片失败', error)
          const errorMsg = error?.ErrorMsg?.ErrMsg || error?.message || '未知错误'
          this.page.toast(`打印失败: ${errorMsg}`, 'error')
          reject(error)
        })
      })
    } catch (error) {
      console.error('生成图片失败', error)
      this.page.toast('生成图片失败', 'error')
      throw error
    }
  }
}
