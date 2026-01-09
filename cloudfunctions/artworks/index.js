// 云函数：作品库
// 用法：wx.cloud.callFunction({ name: 'artworks', data: { action: 'list' } })
// action: list | rename | delete | get

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const COLLECTION = 'artworks'

function pickString(v) {
  return typeof v === 'string' ? v : ''
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = pickString(event && event.action)

  try {
    switch (action) {
      case 'list': {
        const limit = Math.min(Math.max(Number(event.limit || 50), 1), 100)
        console.log('list action, OPENID:', OPENID)
        const res = await db
          .collection(COLLECTION)
          .where({ _openid: OPENID, isDeleted: _.neq(true) })
          .orderBy('updatedAt', 'desc')
          .limit(limit)
          .get()
        console.log('list result count:', res.data.length)
        return { ok: true, data: res.data }
      }

      case 'listAll': {
        // 获取所有作品，不筛选 openid，按 createdAt 降序
        const MAX_LIMIT = 100
        const MAX_TOTAL = 200 // 作品总数上限
        
        // 先获取总数
        const countResult = await db.collection(COLLECTION).count()
        const total = Math.min(countResult.total, MAX_TOTAL) // 限制总数
        console.log('listAll: 总作品数', countResult.total, '限制为', total)
        const batchTimes = Math.ceil(total / MAX_LIMIT)
        console.log('listAll: 需要分', batchTimes, '批获取')
        
        // 分批获取
        const tasks = []
        for (let i = 0; i < batchTimes; i++) {
          const promise = db
            .collection(COLLECTION)
            .orderBy('createdAt', 'desc')
            .skip(i * MAX_LIMIT)
            .limit(MAX_LIMIT)
            .get()
          tasks.push(promise)
        }
        
        const results = await Promise.all(tasks)
        const allData = results.reduce((acc, cur) => {
          return acc.concat(cur.data)
        }, [])
        
        console.log('listAll: 实际获取到', allData.length, '条记录')
        console.log('listAll: openid 列表', [...new Set(allData.map(d => d._openid))])
        
        return { ok: true, data: allData }
      }

      case 'get': {
        const id = pickString(event.id)
        if (!id) return { ok: false, error: 'missing id' }
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }
        return { ok: true, data: doc }
      }

      case 'rename': {
        const id = pickString(event.id)
        const name = pickString(event.name).trim()
        if (!id) return { ok: false, error: 'missing id' }
        if (!name) return { ok: false, error: 'missing name' }

        // 先校验归属
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }

        await db.collection(COLLECTION).doc(id).update({
          data: { name, updatedAt: Date.now() },
        })
        return { ok: true }
      }

      case 'delete': {
        const id = pickString(event.id)
        if (!id) return { ok: false, error: 'missing id' }

        // 先校验归属并拿 fileID
        const res = await db.collection(COLLECTION).doc(id).get()
        const doc = res.data
        if (!doc || doc._openid !== OPENID) return { ok: false, error: 'not found' }

        await db.collection(COLLECTION).doc(id).update({
          data: { isDeleted: true, updatedAt: Date.now() },
        })

        // 可选：删除云存储文件（失败不影响主流程）
        const fileList = [doc.thumbnailFileId, doc.exportFileId].filter(Boolean)
        if (fileList.length) {
          try {
            await cloud.deleteFile({ fileList })
          } catch (e) {
            // ignore
          }
        }

        return { ok: true }
      }

      default:
        return { ok: false, error: 'unknown action' }
    }
  } catch (err) {
    console.error(err)
    return { ok: false, error: 'internal error', detail: err && err.message }
  }
}
