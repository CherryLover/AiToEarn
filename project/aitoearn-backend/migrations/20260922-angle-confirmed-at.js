/**
 * 存量方向补 confirmedAt：现有方向全部视为「人已经确认采用」，把 confirmedAt 补成各自的 createdAt。
 *
 * 为什么要这一步：`confirmedAt` 空表示待确认。不补的话，上线当天所有老方向会一起掉进待确认区，
 * 演进树和状态分组会瞬间空掉。契约里明确要求一次性补齐，不许在读取逻辑里到处判空兼容老数据
 * （判空会散到列表、树、分组、筛选每一处，迟早漏一个）。
 *
 * 跑法（在能连到库的机器上执行，DB 名按环境替换）：
 *   mongosh "mongodb://<user>:<pass>@<host>:27017/<db>?authSource=admin" \
 *     project/aitoearn-backend/migrations/20260922-angle-confirmed-at.js
 *
 * 幂等：只处理还没有 confirmedAt 的文档，重复执行不会把已确认的时间往后挪。
 */

const angles = db.getCollection('angle')

const pending = angles.countDocuments({ confirmedAt: { $exists: false } })
print(`[angle.confirmedAt] 待补齐 ${pending} 条`)

let patched = 0
let fallback = 0

angles.find({ confirmedAt: { $exists: false } }, { createdAt: 1 }).forEach((doc) => {
  // 理论上每条都有 createdAt（schema 带时间戳），真缺了就拿当下兜住，别把字段继续留空
  const confirmedAt = doc.createdAt instanceof Date ? doc.createdAt : new Date()
  if (!(doc.createdAt instanceof Date))
    fallback += 1

  angles.updateOne({ _id: doc._id }, { $set: { confirmedAt } })
  patched += 1
})

print(`[angle.confirmedAt] 已补齐 ${patched} 条，其中 ${fallback} 条缺 createdAt 用当前时间兜底`)
print(`[angle.confirmedAt] 剩余待确认（应为 0）：${angles.countDocuments({ confirmedAt: { $exists: false } })}`)
