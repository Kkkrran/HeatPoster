// 导入打印机SDK
import bleTool from '../../SUPVANAPIT50PRO/BLETool.js'
import bleToothManage from '../../SUPVANAPIT50PRO/BLEToothManage.js'

// --- 接口定义 ---

interface BluetoothDevice {
  deviceId: string
  name?: string
  RSSI?: number
  advertisData?: ArrayBuffer
}

// 存储键名常量
const STORAGE_KEYS = {
  EXIT_CONFIRM: 'editor_exit_confirm',
  MAX_UNDO: 'editor_max_undo_steps',
  PURE_BLACK_BRUSH: 'editor_pure_black_brush',
  ALBUM_SCROLL_SPEED: 'album_scroll_speed'
}

Component({
  data: {
    exitConfirm: false,
    maxUndoSteps: 10,
    albumScrollSpeed: 5,
    pureBlackBrush: false,
    limitDialogVisible: false,
    tempLimitValue: '',
    speedDialogVisible: false,
    tempSpeedValue: '',
    blueList: [],
    connectedDevice: null,
    isScanning: false,
    cloudImageUrl: '', // 云存储图片的临时路径
    consumableInfoVisible: false, // 耗材信息对话框显示状态
    consumableInfo: null, // 耗材信息数据
  },

  lifetimes: {
    attached() {
      const self = this as any
      let exitConfirm = wx.getStorageSync(STORAGE_KEYS.EXIT_CONFIRM)
      if (exitConfirm === '') exitConfirm = false // 默认为关闭
      
      const maxUndoSteps = wx.getStorageSync(STORAGE_KEYS.MAX_UNDO) || 10
      const albumScrollSpeed = wx.getStorageSync(STORAGE_KEYS.ALBUM_SCROLL_SPEED) || 5
      
      const pureBlackBrush = !!wx.getStorageSync(STORAGE_KEYS.PURE_BLACK_BRUSH)
      
      // 不自动加载已保存的打印机连接信息
      // 默认状态为未连接，只有用户主动搜索并连接设备后才显示已连接
      // 这样可以确保每次打开小程序时都是未连接状态，需要重新搜索和连接
      self.setData({ connectedDevice: null })
      
      self.setData({ 
        exitConfirm, 
        maxUndoSteps,
        albumScrollSpeed,
        pureBlackBrush
      })
    }
  },

  pageLifetimes: {
    show() {
      // 保持屏幕常亮
      wx.setKeepScreenOn({
        keepScreenOn: true
      })
      // 每次页面显示时都重新加载所有设置（从背景选择页返回时会更新）
      ;(this as any).refreshAllSettings()
    }
  },

  methods: {
    refreshAllSettings() {
      const self = this as any
      // 重新加载退出确认设置
      let exitConfirm = wx.getStorageSync('editor_exit_confirm')
      if (exitConfirm === '') exitConfirm = false // 默认为关闭
      
      self.setData({ 
        exitConfirm
      })
    },

    onExitConfirmChange(e: any) {
      const val = e.detail.value
      ;(this as any).setData({ exitConfirm: val })
      wx.setStorageSync(STORAGE_KEYS.EXIT_CONFIRM, val)
    },

    onPureBlackBrushChange(e: any) {
      const val = e.detail.value
      ;(this as any).setData({ pureBlackBrush: val })
      wx.setStorageSync(STORAGE_KEYS.PURE_BLACK_BRUSH, val)
      wx.showToast({ title: val ? '已开启纯黑画笔' : '已恢复热力色', icon: 'success' })
    },

    // --- 滚动速度设置相关 ---
    onEditScrollSpeed() {
      const self = this as any
      self.setData({
        speedDialogVisible: true,
        tempSpeedValue: self.data.albumScrollSpeed.toString()
      })
    },

    onSpeedInputChange(e: any) {
      this.setData({ tempSpeedValue: e.detail.value })
    },

    onSpeedCancel() {
      this.setData({ speedDialogVisible: false })
    },

    onSpeedConfirm() {
      const self = this as any
      const val = parseInt(self.data.tempSpeedValue, 10)
      if (isNaN(val) || val < 1 || val > 999) {
        wx.showToast({ title: '请输入1-999间的数字', icon: 'none' })
        return
      }
      self.setData({
        albumScrollSpeed: val,
        speedDialogVisible: false
      })
      wx.setStorageSync(STORAGE_KEYS.ALBUM_SCROLL_SPEED, val)
      wx.showToast({ title: '设置已保存', icon: 'none' })
    },
    // --- 结束 ---

    onEditUndoLimit() {
      const self = this as any
      self.setData({
        limitDialogVisible: true,
        tempLimitValue: self.data.maxUndoSteps.toString()
      })
    },

    onLimitInputChange(e: any) {
      ;(this as any).setData({ tempLimitValue: e.detail.value })
    },

    onLimitCancel() {
      ;(this as any).setData({ limitDialogVisible: false })
    },

    onLimitConfirm() {
      const val = parseInt((this as any).data.tempLimitValue, 10)
      if (isNaN(val) || val < 5 || val > 20) {
        wx.showToast({ title: '请输入5-20之间的整数', icon: 'none' })
        return
      }
      ;(this as any).setData({ 
        maxUndoSteps: val,
        limitDialogVisible: false
      })
      wx.setStorageSync(STORAGE_KEYS.MAX_UNDO, val)
      wx.showToast({ title: '设置成功', icon: 'success' })
    },

    onRequestAlbumAuth() {
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => wx.showToast({ title: '授权成功', icon: 'success' }),
        fail: () => (this as any).handlePermissionDenied('相册保存'),
      })
    },

    onOpenSetting() {
      wx.openSetting({})
    },

    onClearCache() {
      wx.showModal({
        title: '清理缓存',
        content: '确定要删除本地生成的临时文件吗？',
        success: (res) => {
          if (res.confirm) {
            const fs = wx.getFileSystemManager()
            try {
              const userDataPath = wx.env.USER_DATA_PATH
              const files = fs.readdirSync(userDataPath)
              let count = 0
              files.forEach(file => {
                // 仅删除常见的临时扩展名，避免误删配置文件
                if (['.json', '.png', '.jpg', '.jpeg'].some(ext => file.endsWith(ext))) {
                  try {
                    fs.unlinkSync(`${userDataPath}/${file}`)
                    count++
                  } catch(e) {}
                }
              })
              wx.showToast({ title: `清理完成(${count})`, icon: 'success' })
            } catch (err) {
              wx.showToast({ title: '清理失败', icon: 'none' })
            }
          }
        }
      })
    },

    onBackHome() {
      wx.navigateBack({ delta: 1 })
    },

    onGoAlbum() {
      wx.navigateTo({ url: '/pages/album/album' })
    },

    // --- 蓝牙核心逻辑 ---

    async clickStartScanBleDevice() {
      const self = this as any
      
      // 如果正在搜索，则停止搜索
      if (self.data.isScanning) {
        self.clickStopScanBleDevices()
        return
      }

      try {
        // 1. 请求蓝牙权限并初始化蓝牙适配器
        await self.requestBluetoothPermissions()

        // 2. 清空设备列表并开始搜索
        self.data.blueList = []
        self.setData({ 
          blueList: [],
          isScanning: true
        })

        // 3. 调用SDK扫描蓝牙设备
        // @ts-ignore - SDK回调类型可能不完全匹配
        bleTool.scanBleDeviceList((res: any) => {
          console.log('搜索到的蓝牙设备:', res)
          if (res && res.ResultCode == 0) { // ResultCode 为 0 表示成功
            if (res.ResultValue && res.ResultValue.devices && res.ResultValue.devices[0]) {
              const device = res.ResultValue.devices[0]
              // 检查设备是否已存在，避免重复添加
              if (!self.data.blueList.some((d: BluetoothDevice) => d.deviceId === device.deviceId)) {
                self.data.blueList.push(device)
                self.setData({
                  blueList: self.data.blueList
                })
              }
            }
          }
        }).catch((error: any) => {
          console.error('搜索蓝牙设备失败:', error)
          wx.showToast({ title: '搜索失败', icon: 'none' })
          self.setData({ isScanning: false })
        })
      } catch (error) {
        console.error('蓝牙搜索准备失败', error)
        self.setData({ isScanning: false })
      }
    },

    clickStopScanBleDevices() {
      const self = this as any
      if (typeof bleTool.stopScanBleDevices === 'function') {
        bleTool.stopScanBleDevices().then((res: any) => {
          console.log('停止搜索蓝牙设备成功', res)
          self.setData({ isScanning: false })
          wx.showToast({
            title: '停止搜索',
            icon: 'none'
          })
        }).catch((error: any) => {
          console.error('停止搜索蓝牙设备失败:', error)
          self.setData({ isScanning: false })
        })
      } else {
        self.setData({ isScanning: false })
      }
    },

    clickConnectBleDevice(e: any) {
      const self = this as any
      const device = e.currentTarget.dataset.device
      if (!device) {
        wx.showToast({ title: '设备信息无效', icon: 'none' })
        return
      }

      wx.showLoading({ title: '连接中...', mask: true })
      
      // 如果正在搜索，先停止搜索
      if (self.data.isScanning) {
        self.clickStopScanBleDevices()
      }

      // 连接蓝牙设备
      bleTool.connectBleDevice(device).then((res: any) => {
        console.log('连接蓝牙设备成功', res)
        wx.hideLoading()
        self.setData({ 
          connectedDevice: device
        })
        // 保存连接信息到本地存储，供其他页面使用
        wx.setStorageSync('connected_printer_device', device)
        
        // 通知其他页面更新连接状态
        // 通过获取所有页面实例并调用同步方法
        const pages = getCurrentPages()
        pages.forEach((page: any) => {
          if (page.printManager && typeof page.printManager.syncConnectionFromStorage === 'function') {
            page.printManager.syncConnectionFromStorage()
          }
        })
        
        wx.showToast({
          title: '连接成功',
          icon: 'success'
        })
      }).catch((error: any) => {
        console.error('连接蓝牙设备失败', error)
        wx.hideLoading()
        wx.showToast({
          title: '连接失败',
          icon: 'none'
        })
      })
    },

    clickDisconnectBleDevice() {
      const self = this as any
      if (!self.data.connectedDevice) {
        wx.showToast({ title: '当前未连接设备', icon: 'none' })
        return
      }

      bleTool.disconnectBleDevice().then((res: any) => {
        console.log('断开蓝牙设备成功', res)
        self.setData({ connectedDevice: null })
        // 清除本地存储的连接信息
        wx.removeStorageSync('connected_printer_device')
        
        // 通知其他页面更新连接状态
        const pages = getCurrentPages()
        pages.forEach((page: any) => {
          if (page.printManager && typeof page.printManager.syncConnectionFromStorage === 'function') {
            page.printManager.syncConnectionFromStorage()
          }
        })
        
        wx.showToast({ 
          title: '已断开连接',
          icon: 'success'
        })
      }).catch((error: any) => {
        console.error('断开蓝牙设备失败', error)
        // 即使断开失败，也清除连接状态
        self.setData({ connectedDevice: null })
        wx.removeStorageSync('connected_printer_device')
        
        // 通知其他页面更新连接状态
        const pages = getCurrentPages()
        pages.forEach((page: any) => {
          if (page.printManager && typeof page.printManager.syncConnectionFromStorage === 'function') {
            page.printManager.syncConnectionFromStorage()
          }
        })
        
        wx.showToast({ 
          title: '断开失败',
          icon: 'none'
        })
      })
    },

    clickConsumableInformation() {
      const self = this as any
      
      // 检查是否已连接设备
      if (!self.data.connectedDevice) {
        wx.showToast({ 
          title: '请先连接打印机', 
          icon: 'none',
          duration: 2000
        })
        return
      }

      console.log('获取耗材信息')
      wx.showLoading({ title: '获取中...', mask: true })
      
      bleToothManage.ConsumableInformation().then((res: any) => {
        console.log('耗材信息获取成功', res)
        wx.hideLoading()
        
        // 解析返回结果
        if (res && res.ResultCode === 0 && res.ResultValue) {
          const info = res.ResultValue
          self.setData({
            consumableInfo: {
              gap: info.gap || '未知',
              paperDirectionSize: info.paperDirectionSize || '未知',
              printHeadDirectionSize: info.printHeadDirectionSize || '未知'
            },
            consumableInfoVisible: true
          })
        } else {
          // 显示错误信息
          const errorMsg = res?.ErrorMsg || '获取失败'
          wx.showModal({
            title: '获取耗材信息失败',
            content: JSON.stringify(errorMsg),
            showCancel: false
          })
        }
      }).catch((err: any) => {
        console.error('获取耗材信息失败', err)
        wx.hideLoading()
        wx.showModal({
          title: '获取失败',
          content: err?.message || '请检查设备连接状态',
          showCancel: false
        })
      })
    },

    onCloseConsumableInfo() {
      ;(this as any).setData({ consumableInfoVisible: false })
    },


    async requestBluetoothPermissions(): Promise<void> {
      const self = this as any
      return new Promise<void>((resolve, reject) => {
        // 1. 初始化蓝牙适配器
        wx.openBluetoothAdapter({
          success: () => {
            console.log('蓝牙适配器初始化成功')
            // 2. 申请蓝牙权限
            wx.authorize({
              scope: 'scope.bluetooth',
              success: () => {
                // Android 额外需要位置权限
                wx.authorize({
                  scope: 'scope.userLocation',
                  success: () => {
                    console.log('权限申请成功')
                    resolve()
                  },
                  fail: () => {
                    console.warn('位置权限申请失败')
                    self.handlePermissionDenied('位置 (扫描蓝牙需要)')
                    reject()
                  }
                })
              },
              fail: () => {
                console.warn('蓝牙权限申请失败')
                self.handlePermissionDenied('蓝牙')
                reject()
              }
            })
          },
          fail: (err: any) => {
            console.error('蓝牙适配器初始化失败', err)
            wx.showModal({
              title: '提示',
              content: '请开启手机蓝牙功能',
              showCancel: false
            })
            reject(err)
          }
        })
      })
    },

    handlePermissionDenied(permissionType: string) {
      wx.showModal({
        title: '提示',
        content: `需要${permissionType}权限，请在设置中开启。`,
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) wx.openSetting({})
        }
      })
    },

  }
})
