import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const fixtureDir = join(process.cwd(), 'e2e/fixtures/excalidraw')

function readFixture(name: string): any {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'))
}

function findElement(data: any, id: string): any {
  const element = data.elements.find((candidate: any) => candidate.id === id)
  expect(element).toBeTruthy()
  return element
}

function absoluteStart(arrow: any): [number, number] {
  const [x, y] = arrow.points[0]
  return [arrow.x + x, arrow.y + y]
}

function absoluteEnd(arrow: any): [number, number] {
  const [x, y] = arrow.points[arrow.points.length - 1]
  return [arrow.x + x, arrow.y + y]
}

function rightCenter(node: any): [number, number] {
  return [node.x + node.width, node.y + node.height / 2]
}

function leftCenter(node: any): [number, number] {
  return [node.x, node.y + node.height / 2]
}

function expectArrowBetween(data: any, arrowId: string, fromId: string, toId: string) {
  const arrow = findElement(data, arrowId)
  const from = findElement(data, fromId)
  const to = findElement(data, toId)

  expect(absoluteStart(arrow)).toEqual(rightCenter(from))
  expect(absoluteEnd(arrow)).toEqual(leftCenter(to))
}

describe('Excalidraw fixtures', () => {
  const plantumlMigratedFixtures = [
    ['plantuml-sequence-advanced.excalidraw', 'PlantUML 迁移：高级序列图'],
    ['plantuml-class-renderers.excalidraw', 'PlantUML 迁移：渲染器类图'],
    ['plantuml-use-case.excalidraw', 'PlantUML 迁移：用例图'],
    ['plantuml-component-packages.excalidraw', 'PlantUML 迁移：组件图'],
    ['plantuml-object-graph.excalidraw', 'PlantUML 迁移：对象图'],
    ['plantuml-deployment.excalidraw', 'PlantUML 迁移：部署图'],
    ['plantuml-timing-diagram.excalidraw', 'PlantUML 迁移：Timing Diagram'],
    ['plantuml-gantt-plan.excalidraw', 'PlantUML 迁移：甘特图'],
    ['plantuml-wbs.excalidraw', 'PlantUML 迁移：WBS'],
    ['plantuml-config-data.excalidraw', 'PlantUML 迁移：JSON/YAML 数据'],
    ['plantuml-salt-wireframe.excalidraw', 'PlantUML 迁移：Salt 线框'],
    ['plantuml-creole-note.excalidraw', 'PlantUML 迁移：Creole 富文本'],
    ['plantuml-hyperlinks.excalidraw', 'PlantUML 迁移：链接类图'],
    ['plantuml-stereotypes.excalidraw', 'PlantUML 迁移：Stereotypes'],
    ['plantuml-gradient-layers.excalidraw', 'PlantUML 迁移：颜色分层图'],
    ['plantuml-export-sequence.excalidraw', 'PlantUML 迁移：复杂导出序列'],
  ]

  it('应包含从 PlantUML 真实用例迁移来的 Excalidraw 覆盖集', () => {
    for (const [file, titleText] of plantumlMigratedFixtures) {
      const data = readFixture(file)
      const duplicateTitle = data.elements.find((element: any) =>
        element.type === 'text' && element.text === titleText
      )

      expect(data.type).toBe('excalidraw')
      expect(duplicateTitle).toBeUndefined()
      expect(data.elements.filter((element: any) => !element.isDeleted).length).toBeGreaterThan(5)
    }
  })

  it('PlantUML 超链接迁移用例应保留 Excalidraw 元素 link 字段', () => {
    const data = readFixture('plantuml-hyperlinks.excalidraw')
    const controller = findElement(data, 'controller')

    expect(controller.link).toBe('https://example.com/docs/controller')
  })

  it('Unicode 长文本用例应显式换行，避免静态 SVG 文本越过容器', () => {
    const data = readFixture('text-unicode.excalidraw')
    const longLabel = data.elements.find((element: any) => element.id === 'long-label')

    expect(longLabel?.type).toBe('text')
    expect(longLabel.text).toContain('\n')
  })

  it('较大但均衡架构图标题中的节点数应匹配实际节点数', () => {
    const data = readFixture('large-balanced-graph.excalidraw')
    const title = data.elements.find((element: any) => element.id === 'title')
    const nodeCount = data.elements.filter((element: any) =>
      ['rectangle', 'diamond', 'ellipse'].includes(element.type) && !element.isDeleted
    ).length

    expect(title?.text).toContain(`${nodeCount} 节点`)
  })

  it('较大但均衡架构图箭头应连接节点左右边界中心，避免斜插和异常汇聚', () => {
    const data = readFixture('large-balanced-graph.excalidraw')

    expectArrowBetween(data, 'a1', 'c1', 'gw')
    expectArrowBetween(data, 'a2', 'c2', 'gw')
    expectArrowBetween(data, 'a3', 'gw', 's1')
    expectArrowBetween(data, 'a4', 'gw', 's2')
    expectArrowBetween(data, 'a5', 'gw', 's3')
    expectArrowBetween(data, 'a6', 'gw', 's4')
    expectArrowBetween(data, 'a7', 's1', 'd1')
    expectArrowBetween(data, 'a8', 's2', 'd2')
    expectArrowBetween(data, 'a9', 's3', 'd3')
    expectArrowBetween(data, 'a10', 's4', 'q1')
    expectArrowBetween(data, 'a11', 'd1', 'w1')
    expectArrowBetween(data, 'a12', 'd2', 'w2')
    expectArrowBetween(data, 'a13', 'd3', 'w3')
  })
})
