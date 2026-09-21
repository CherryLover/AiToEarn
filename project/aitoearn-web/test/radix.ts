/**
 * Radix 下拉在 jsdom 里的开合助手。
 *
 * 用鼠标那条路在 jsdom 里走不通，两处都断：
 *
 * 1. 打开：Radix 的 Select 是「按下去打开、松手时判断是点一下还是拖着选」。
 *    `userEvent.click` 的按下和松手之间隔多久完全看机器当时有多忙，快了能开、慢了立刻又收回去；
 *    只发 pointerdown 不发 pointerup 也不行——那个没等到的 pointerup 会一直挂在 document 上，
 *    下一个用例刚打开的下拉会被它顺手关掉，于是「单跑一个用例是绿的，整个文件一起跑就红」。
 * 2. 选中：选项靠 `pointermove` 高亮、`pointerup` 选中，jsdom 发不出真实的指针轨迹，
 *    点选项一点反应都没有。
 *
 * 键盘那条路是完整的：Enter 打开、方向键走、Enter 选中，而且不留任何跨用例的残留。
 */
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/** 打开一个 Select，之后用 `findByRole('option')` 取选项；已经开着就什么都不做 */
export async function openSelect(trigger: HTMLElement) {
  if (trigger.getAttribute('aria-expanded') === 'true')
    return

  trigger.focus()
  await userEvent.keyboard('{Enter}')
}

/** 打开一个 Select 并选中某一项，`name` 是选项的无障碍名 */
export async function chooseOption(trigger: HTMLElement, name: string | RegExp) {
  await openSelect(trigger)

  const target = await screen.findByRole('option', { name })
  const options = screen.getAllByRole('option')
  // 打开时 Radix 把焦点落在当前值那一项上，从那儿数着走过去
  const from = Math.max(options.findIndex(option => option === document.activeElement), 0)
  const to = options.indexOf(target)
  const step = to > from ? '{ArrowDown}' : '{ArrowUp}'

  await userEvent.keyboard(`${step.repeat(Math.abs(to - from))}{Enter}`)
}

/** 打开一个下拉菜单（DropdownMenu / ContextMenu 这类），打开后焦点在第一项上 */
export async function openMenu(trigger: HTMLElement) {
  if (trigger.getAttribute('aria-expanded') === 'true')
    return

  trigger.focus()
  await userEvent.keyboard('{Enter}')
  await screen.findByRole('menu')
}

/** 打开菜单并点某一项，`name` 是菜单项的无障碍名 */
export async function chooseMenuItem(trigger: HTMLElement, name: string | RegExp) {
  await openMenu(trigger)

  const target = await screen.findByRole('menuitem', { name })
  const items = screen.getAllByRole('menuitem')
  // 打开时焦点落在第一项，从那儿数着走过去
  const from = Math.max(items.findIndex(item => item === document.activeElement), 0)
  const to = items.indexOf(target)
  const step = to > from ? '{ArrowDown}' : '{ArrowUp}'

  await userEvent.keyboard(`${step.repeat(Math.abs(to - from))}{Enter}`)
}
