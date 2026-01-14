// pages/album/album.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    paddingTop: 0,
    artworks: []
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 获取状态栏高度和胶囊按钮位置，计算顶部内边距
    // 简单起见，这里只处理状态栏高度，通常建议留出头部导航区域
    const { statusBarHeight } = wx.getSystemInfoSync();
    // 加上一些额外的间距，比如导航栏的高度通常是44px(88rpx)，但这里我们想利用空间，
    // 可能只需要避开状态栏即可, 或者给一点点 breathing room
    // 胶囊按钮通常在 statusBarHeight + (44 - 32)/2 的位置
    // 我们让 header 的 padding-top = statusBarHeight + 10px 左右比较合适
    this.setData({
      paddingTop: statusBarHeight + 12 
    });
    
    this.loadArtworks();
  },

  loadArtworks() {
    // 模拟加载或者是从缓存/云端加载
    // 这里假设有一个获取数据的逻辑
  },

  goBack() {
    wx.navigateBack();
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})



