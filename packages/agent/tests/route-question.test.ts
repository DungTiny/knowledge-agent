import { describe, expect, test } from 'bun:test'
import { applyRoutingGuardrails, ORDER_WORKFLOW_REASON_PREFIX } from '../src/router/route-question'
import type { AgentConfig } from '../src/router/schema'

const simpleConfig: AgentConfig = {
  complexity: 'simple',
  maxSteps: 8,
  model: 'google/gemini-3-flash',
  reasoning: 'Simple formatting request',
}

describe('applyRoutingGuardrails', () => {
  test('promotes a large Vietnamese order to a 25-step complex workflow', () => {
    const question = `hãy lên đơn
Mứt xoài 1 hộp
Đào lon 1 lon
Trà đào cozy 1 hộp
Cam sấy khô 200gr
Cốt dừa 4 lon
Richs 12 hộp
Thạch agar 1 hộp
Trà lài 1kg`

    expect(applyRoutingGuardrails(question, simpleConfig)).toMatchObject({
      complexity: 'complex',
      maxSteps: 25,
      reasoning: expect.stringContaining(ORDER_WORKFLOW_REASON_PREFIX),
    })
  })

  test('promotes a small order to a 15-step moderate workflow', () => {
    expect(applyRoutingGuardrails('lên bill\nRichs 12 hộp', simpleConfig)).toMatchObject({
      complexity: 'moderate',
      maxSteps: 15,
    })
  })

  test('promotes a structurally itemized order without an explicit intent phrase', () => {
    const question = `Cốt dừa Wonderfarm 5 hộp
Đào hồng wonderful 1 lon

04 Trương Định`

    expect(applyRoutingGuardrails(question, simpleConfig)).toMatchObject({
      complexity: 'moderate',
      maxSteps: 15,
      reasoning: expect.stringContaining(ORDER_WORKFLOW_REASON_PREFIX),
    })
  })

  test('routes the Anh Công Đức shorthand order as a large order', () => {
    const question = `Anh Công Đức FB
1 thùng bột béo
1 thùng sữa tươi
10kg đường
1 bột kem trứng brulee
1 hộp rau câu
1 sinh tố đào
5 rich
1 base
1 bột mole dưa lưới
5 trân châu đen
1 siro dâu dingfong
1 siro vải dinhfong
1 siro mảng cầu đậm đặc
1 siro chanh dây đậm đặc
1 siro thơm đậm đặc
1 cái vợt múc trân châu`

    expect(applyRoutingGuardrails(question, simpleConfig)).toMatchObject({
      complexity: 'complex',
      maxSteps: 25,
      reasoning: expect.stringContaining(ORDER_WORKFLOW_REASON_PREFIX),
    })
  })

  test('does not modify an ordinary lookup', () => {
    expect(applyRoutingGuardrails('Richs là sản phẩm gì?', simpleConfig)).toEqual(simpleConfig)
  })

  test('does not reduce an already larger budget', () => {
    const existing: AgentConfig = { ...simpleConfig, complexity: 'complex', maxSteps: 30 }
    expect(applyRoutingGuardrails('hãy tạo đơn\nRichs 12 hộp', existing)).toMatchObject({
      complexity: 'complex',
      maxSteps: 30,
      reasoning: expect.stringContaining(ORDER_WORKFLOW_REASON_PREFIX),
    })
  })
})
