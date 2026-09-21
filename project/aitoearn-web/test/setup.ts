import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

/**
 * Radix 的 Select、Dropdown 这些靠指针捕获实现「按下去拖到某一项再松手」，
 * jsdom 没有这套 API，点一下下拉框就会在事件回调里抛 TypeError，
 * 而且是从 React 的事件系统里抛出来的，会被算成未捕获异常，测试全程红一片。
 * 这里补成空实现：用例只用点击选，不依赖真实的指针捕获行为。
 */
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = () => false
if (!Element.prototype.setPointerCapture)
  Element.prototype.setPointerCapture = () => {}
if (!Element.prototype.releasePointerCapture)
  Element.prototype.releasePointerCapture = () => {}
// Radix 选中项之后会把它滚进可视区，jsdom 里同样没有
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()

  /**
   * 弹窗和下拉开着的时候，Radix 会把页面上其它节点标成 aria-hidden，关掉时再还原。
   * 用例结束时组件是被直接卸载的，那份还原没机会跑，标记就留在了 body 上，
   * 下一个用例里 `getByRole` 看到的是一棵「对读屏隐藏」的树，什么都查不到。
   */
  document.querySelectorAll('[data-aria-hidden]').forEach((el) => {
    el.removeAttribute('aria-hidden')
    el.removeAttribute('data-aria-hidden')
  })
  // 关闭层会在开着的时候把 body 的指针事件掐掉，同样需要还原
  document.body.style.pointerEvents = ''
})
