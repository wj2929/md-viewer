# WaveDrom Renderer 综合测试

本文档覆盖时钟、握手、总线、分组、流水线、复位、寄存器和较宽时序场景。

---

## 1. 请求响应握手

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p.......' },
  { name: 'req', wave: '0.1..0..' },
  { name: 'ack', wave: '0...1.0.' },
  { name: 'data', wave: 'x.345x..', data: ['A0', 'A1', 'A2'] }
] }
```

## 2. 总线读写

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p.........' },
  { name: 'cs',  wave: '1.0......1' },
  { name: 'rw',  wave: 'x.0..1...x' },
  { name: 'addr', wave: 'x.=..=...x', data: ['0x10', '0x20'] },
  { name: 'data', wave: 'x...=.=..x', data: ['read', 'write'] }
] }
```

## 3. 分组时序

```wavedrom
{ signal: [
  ['控制',
    { name: 'enable', wave: '0.1.....0' },
    { name: 'ready', wave: '0...1...0' }
  ],
  ['数据',
    { name: 'input', wave: 'x.=.=...x', data: ['in0', 'in1'] },
    { name: 'output', wave: 'x...=.=x', data: ['out0', 'out1'] }
  ]
] }
```

## 4. 复位启动

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p...........' },
  { name: 'rst_n', wave: '0..1.......' },
  { name: 'init', wave: '0...1.0....' },
  { name: 'ready', wave: '0......1...' },
  { name: 'state', wave: 'x.3.4.5.6.x', data: ['RESET', 'LOAD', 'CHECK', 'RUN'] }
] }
```

## 5. 四级流水线

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'fetch', wave: 'x.3.4.5.6.x..', data: ['I0', 'I1', 'I2', 'I3'] },
  { name: 'decode', wave: 'x..3.4.5.6.x.', data: ['I0', 'I1', 'I2', 'I3'] },
  { name: 'execute', wave: 'x...3.4.5.6.x', data: ['I0', 'I1', 'I2', 'I3'] },
  { name: 'writeback', wave: 'x....3.4.5.6', data: ['I0', 'I1', 'I2', 'I3'] }
] }
```

## 6. 缓存命中与回填

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p...........' },
  { name: 'valid', wave: '0.1.....0..' },
  { name: 'hit', wave: 'x.1.0...1.x' },
  { name: 'miss', wave: '0...1.0....' },
  { name: 'refill', wave: '0....1.0...' },
  { name: 'addr', wave: 'x.=.=...=.x', data: ['0x40', '0x88', '0x90'] }
] }
```

## 7. SPI 传输

```wavedrom
{ signal: [
  { name: 'sclk', wave: 'lhlhlhlhlhlhlh' },
  { name: 'cs_n', wave: '1.0..........1' },
  { name: 'mosi', wave: 'x.3.4.5.6.7.8.x', data: ['1', '0', '1', '1', '0', '1'] },
  { name: 'miso', wave: 'x.4.5.6.7.8.9.x', data: ['0', '1', '0', '0', '1', '1'] }
] }
```

## 8. AXI-Lite 写事务

```wavedrom
{ signal: [
  ['地址通道',
    { name: 'awvalid', wave: '0.1...0...' },
    { name: 'awready', wave: '0..1..0...' },
    { name: 'awaddr', wave: 'x.=...x...', data: ['0x1000'] }
  ],
  ['数据通道',
    { name: 'wvalid', wave: '0..1..0...' },
    { name: 'wready', wave: '0...1.0...' },
    { name: 'wdata', wave: 'x..=..x...', data: ['0xCAFE'] }
  ],
  ['响应通道',
    { name: 'bvalid', wave: '0.....1.0.' },
    { name: 'bready', wave: '1........1' }
  ]
] }
```

## 9. 状态寄存器

```wavedrom
{ reg: [
  { name: 'busy', bits: 1, attr: 'R' },
  { name: 'error', bits: 1, attr: 'R/W1C' },
  { name: 'mode', bits: 2, attr: 'RW' },
  { name: 'reserved', bits: 4 },
  { name: 'count', bits: 8, attr: 'RO' },
  { name: 'threshold', bits: 16, attr: 'RW' }
] }
```

## 10. 较宽同步时序

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p................' },
  { name: 'window', wave: '0.1............0' },
  { name: 'sample', wave: '0..1010101010..0' },
  { name: 'phase', wave: 'x.3.4.5.6.7.8.9.x', data: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6'] },
  { name: 'out', wave: 'x......=.==..=.x', data: ['A', 'B', 'C', 'D'] }
] }
```

## 11. I2C 控制寄存器

```wavedrom
{ reg: [
  { name: 'enable', bits: 1, attr: 'RW' },
  { name: 'start', bits: 1, attr: 'W1S' },
  { name: 'stop', bits: 1, attr: 'W1S' },
  { name: 'ack_error', bits: 1, attr: 'R/W1C' },
  { name: 'speed_mode', bits: 2, attr: 'RW' },
  { name: 'address_bits', bits: 2, attr: 'RW' },
  { name: 'tx_fifo_level', bits: 8, attr: 'RO' },
  { name: 'rx_fifo_level', bits: 8, attr: 'RO' },
  { name: 'reserved', bits: 8 }
] }
```

## 12. UART 字节帧

```wavedrom
{ signal: [
  { name: 'tx', wave: '1.0.3.4.5.6.7.8.9.1', data: ['start', 'b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'stop'] },
  { name: 'sample', wave: '0..1010101010..0' }
] }
```

## 13. 请求仲裁

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p.........' },
  { name: 'req0', wave: '0.1...0...' },
  { name: 'req1', wave: '0..1...0..' },
  { name: 'grant0', wave: '0..1..0...' },
  { name: 'grant1', wave: '0.....1.0.' }
] }
```

## 14. 双时钟域

```wavedrom
{ signal: [
  { name: 'clk_a', wave: 'p...........' },
  { name: 'clk_b', wave: 'P.....P.....' },
  { name: 'valid_a', wave: '0.1.....0...' },
  { name: 'sync_b', wave: '0....1...0..' },
  { name: 'ack_a', wave: '0......1.0..' }
] }
```

## 15. 读缓存流水

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'addr', wave: 'x.=.=.=.=..x.', data: ['A0', 'A1', 'A2', 'A3'] },
  { name: 'tag_hit', wave: 'x..1.1.0.1.x.' },
  { name: 'mem_req', wave: '0......1.0...' },
  { name: 'data', wave: 'x...=.=...=.x', data: ['D0', 'D1', 'D2'] }
] }
```

## 16. 写屏障

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p..........' },
  { name: 'write', wave: '0.1.0.1.0..' },
  { name: 'barrier', wave: '0.....1.0..' },
  { name: 'flush', wave: '0......1.0.' },
  { name: 'done', wave: '0........1.' }
] }
```

## 17. DMA 突发

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p..............' },
  { name: 'start', wave: '0.1.0.........' },
  { name: 'addr', wave: 'x.=.=.=.=.=.x.', data: ['0x00', '0x04', '0x08', '0x0C', '0x10'] },
  { name: 'beat', wave: 'x.3.4.5.6.7.x.', data: ['0', '1', '2', '3', '4'] },
  { name: 'irq', wave: '0...........1.0' }
] }
```

## 18. 中断屏蔽

```wavedrom
{ signal: [
  { name: 'irq_raw', wave: '0.1.0.1.0.1.0' },
  { name: 'mask', wave: '0.....1...0..' },
  { name: 'irq_out', wave: '0.1.0.....1.0' },
  { name: 'ack', wave: '0..1.0.....1.' }
] }
```

## 19. 简单状态图

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p.........' },
  { name: 'state', wave: 'x.3.4.5.3.x', data: ['IDLE', 'LOAD', 'RUN', 'IDLE'] },
  { name: 'valid', wave: '0..1..0...' },
  { name: 'error', wave: '0......1.0' }
] }
```

## 20. 位字段组合

```wavedrom
{ reg: [
  { name: 'enable', bits: 1, attr: 'RW' },
  { name: 'priority', bits: 3, attr: 'RW' },
  { name: 'source', bits: 4, attr: 'RO' },
  { name: 'timeout', bits: 8, attr: 'RW' },
  { name: 'last_error', bits: 8, attr: 'R/W1C' },
  { name: 'reserved', bits: 8 }
] }
```

## 21. APB 读事务

```wavedrom
{ signal: [
  { name: 'pclk', wave: 'p...........' },
  { name: 'psel', wave: '0.1.......0' },
  { name: 'penable', wave: '0..1......0' },
  { name: 'pwrite', wave: '0..........' },
  { name: 'paddr', wave: 'x.=.......x', data: ['0x24'] },
  { name: 'prdata', wave: 'x....=....x', data: ['0x1234'] },
  { name: 'pready', wave: '0....1....0' }
] }
```

## 22. APB 写事务

```wavedrom
{ signal: [
  { name: 'pclk', wave: 'p...........' },
  { name: 'psel', wave: '0.1.......0' },
  { name: 'penable', wave: '0..1......0' },
  { name: 'pwrite', wave: '0.1.......0' },
  { name: 'paddr', wave: 'x.=.......x', data: ['0x30'] },
  { name: 'pwdata', wave: 'x.=.......x', data: ['0xBEEF'] },
  { name: 'pready', wave: '0...1.....0' }
] }
```

## 23. Ready Valid 反压

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'valid', wave: '0.1.......0..' },
  { name: 'ready', wave: '0..1.0.1..0..' },
  { name: 'fire', wave: '0..1...1..0..' },
  { name: 'data', wave: 'x.=...=...x..', data: ['A', 'B'] }
] }
```

## 24. AXI 读地址与数据

```wavedrom
{ signal: [
  ['AR 通道',
    { name: 'arvalid', wave: '0.1...0...' },
    { name: 'arready', wave: '0..1..0...' },
    { name: 'araddr', wave: 'x.=...x...', data: ['0x2000'] }
  ],
  ['R 通道',
    { name: 'rvalid', wave: '0....1.0..' },
    { name: 'rready', wave: '1.........' },
    { name: 'rdata', wave: 'x....=x...', data: ['0xCAFE'] }
  ]
] }
```

## 25. AXI 突发写

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p..............' },
  { name: 'awvalid', wave: '0.1..0........' },
  { name: 'awlen', wave: 'x.=..x........', data: ['4'] },
  { name: 'wvalid', wave: '0..1.1.1.1.0..' },
  { name: 'wdata', wave: 'x..=.=.=.=.x..', data: ['D0', 'D1', 'D2', 'D3'] },
  { name: 'wlast', wave: '0........1.0..' },
  { name: 'bvalid', wave: '0..........1.0' }
] }
```

## 26. 异步 FIFO

```wavedrom
{ signal: [
  { name: 'wr_clk', wave: 'p...........' },
  { name: 'rd_clk', wave: 'P.....P.....' },
  { name: 'wr_en', wave: '0.1.0.1.0..' },
  { name: 'rd_en', wave: '0....1.0.1.' },
  { name: 'full', wave: '0..........' },
  { name: 'empty', wave: '1...0....1.' }
] }
```

## 27. 多级复位释放

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'por_n', wave: '0...1........' },
  { name: 'pll_lock', wave: '0.....1......' },
  { name: 'rst_sync1', wave: '0......1.....' },
  { name: 'rst_sync2', wave: '0.......1....' },
  { name: 'init_done', wave: '0..........1.' }
] }
```

## 28. 乱序返回

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p..............' },
  { name: 'req_id', wave: 'x.=.=.=.....x.', data: ['0', '1', '2'] },
  { name: 'resp_id', wave: 'x.....=.=.=.x.', data: ['1', '0', '2'] },
  { name: 'resp_valid', wave: '0.....1.1.1.0' }
] }
```

## 29. CRC 校验

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'data_en', wave: '0.1......0...' },
  { name: 'data', wave: 'x.=.=.=.=x...', data: ['B0', 'B1', 'B2', 'B3'] },
  { name: 'crc_en', wave: '0.........1.0' },
  { name: 'crc', wave: 'x.........=.x', data: ['0x5A'] }
] }
```

## 30. 带空闲间隔的帧

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p................' },
  { name: 'frame', wave: '0.1....0..1....0' },
  { name: 'byte', wave: 'x.=.=..x..=.=..x', data: ['H', 'L', 'D0', 'D1'] },
  { name: 'valid', wave: '0.1.1..0..1.1..0' }
] }
```

## 31. 错误注入

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p..........' },
  { name: 'valid', wave: '0.1.....0.' },
  { name: 'data', wave: 'x.=.=.=.x.', data: ['OK0', 'BAD', 'OK1'] },
  { name: 'parity', wave: '0...1.0...' },
  { name: 'error', wave: '0....1.0..' }
] }
```

## 32. 长标签寄存器

```wavedrom
{ reg: [
  { name: 'renderer_plugin_enable', bits: 1, attr: 'RW' },
  { name: 'network_policy_blocked', bits: 1, attr: 'RW' },
  { name: 'export_format_mask', bits: 4, attr: 'RW' },
  { name: 'last_renderer_error_code', bits: 8, attr: 'RO' },
  { name: 'reserved_for_future_renderers', bits: 18 }
] }
```

## 33. 64 位寄存器

```wavedrom
{ reg: [
  { name: 'enable', bits: 1, attr: 'RW' },
  { name: 'mode', bits: 3, attr: 'RW' },
  { name: 'counter_low', bits: 28, attr: 'RO' },
  { name: 'counter_high', bits: 32, attr: 'RO' }
] }
```

## 34. 总线矩阵请求

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............' },
  { name: 'm0_req', wave: '0.1....0....' },
  { name: 'm1_req', wave: '0..1....0...' },
  { name: 's0_grant', wave: '0..1..0.....' },
  { name: 's1_grant', wave: '0.....1.0...' },
  { name: 'route', wave: 'x..=..=..x..', data: ['M0-S0', 'M1-S1'] }
] }
```

## 35. 多阶段导出时序

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p...............' },
  { name: 'parse', wave: '0.1..0.........' },
  { name: 'render', wave: '0...1....0.....' },
  { name: 'capture', wave: '0.......1..0...' },
  { name: 'convert', wave: '0..........1.0.' },
  { name: 'done', wave: '0............1.' }
] }
```

## 36. 宽图滚动压力

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p........................' },
  { name: 'sample', wave: '0.10101010101010101010.0' },
  { name: 'packet', wave: 'x.=.=.=.=.=.=.=.=.=.=.x', data: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9'] },
  { name: 'ready', wave: '1..0..1..0..1..0..1..0.' }
] }
```

## 37. AXI 全通道并发

```wavedrom
{ signal: [
  { name: 'aclk', wave: 'p....................' },
  { name: 'awvalid', wave: '0.1..0...............' },
  { name: 'awready', wave: '0..1.0...............' },
  { name: 'wvalid', wave: '0...1.1.1.1.0........' },
  { name: 'wready', wave: '0...1.1.0.1.0........' },
  { name: 'wdata', wave: 'x...=.=.=.=.x........', data: ['D0', 'D1', 'D2', 'D3'] },
  { name: 'wlast', wave: '0.........1.0........' },
  { name: 'bvalid', wave: '0............1.0.....' },
  { name: 'arvalid', wave: '0......1..0..........' },
  { name: 'rvalid', wave: '0...........1.1.0....' },
  { name: 'rdata', wave: 'x...........=.=.x....', data: ['R0', 'R1'] }
] }
```

## 38. PCIe 简化事务

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p....................' },
  { name: 'tx_valid', wave: '0.1.1.1.0...1.1.0...' },
  { name: 'tx_ready', wave: '1..0.1.1....1.0.1...' },
  { name: 'tx_tlp', wave: 'x.=.=.=x...=.=x.....', data: ['HDR', 'ADDR', 'DATA', 'CPL', 'CRC'] },
  { name: 'rx_valid', wave: '0......1.1.0........' },
  { name: 'rx_tlp', wave: 'x......=.=.x........', data: ['CPLD', 'STATUS'] },
  { name: 'credit', wave: 'x.7.6.5.4.5.4.3.4.x', data: ['8', '7', '6', '5', '6', '5', '4', '5'] }
] }
```

## 39. DDR 读写突发

```wavedrom
{ signal: [
  { name: 'ck', wave: 'p......................' },
  { name: 'cmd', wave: 'x.=...=...=...=.....x', data: ['ACT', 'RD', 'PRE', 'ACT'] },
  { name: 'bank', wave: 'x.=...=...=...=.....x', data: ['B0', 'B0', 'B0', 'B1'] },
  { name: 'addr', wave: 'x.=...=...x...=.....x', data: ['ROW0', 'COL0', 'ROW1'] },
  { name: 'dq', wave: 'z......=.=.=.=......z', data: ['D0', 'D1', 'D2', 'D3'] },
  { name: 'dqs', wave: 'z......101010......z' },
  { name: 'ready', wave: '0.....1.......0.....' }
] }
```

## 40. 流水线阻塞与旁路

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p....................' },
  { name: 'fetch', wave: 'x.3.4.5.6.7.8.x......', data: ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'] },
  { name: 'decode', wave: 'x..3.4.5.6.7.8.x.....', data: ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'] },
  { name: 'stall', wave: '0.....1.0............' },
  { name: 'execute', wave: 'x...3.4.5..6.7.8.x...', data: ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'] },
  { name: 'bypass', wave: '0.......1.0..........' },
  { name: 'writeback', wave: 'x.....3.4.5.6.7.8.x.', data: ['I0', 'I1', 'I2', 'I3', 'I4', 'I5'] }
] }
```

## 41. 复杂中断控制寄存器

```wavedrom
{ reg: [
  { name: 'global_enable', bits: 1, attr: 'RW' },
  { name: 'priority', bits: 3, attr: 'RW' },
  { name: 'pending_mask', bits: 8, attr: 'R/W1C' },
  { name: 'active_vector', bits: 8, attr: 'RO' },
  { name: 'target_core', bits: 4, attr: 'RW' },
  { name: 'edge_level_select', bits: 4, attr: 'RW' },
  { name: 'reserved', bits: 4 }
] }
```

## 42. 图表渲染配置寄存器

```wavedrom
{ reg: [
  { name: 'renderer_enable_mask', bits: 12, attr: 'RW' },
  { name: 'network_policy', bits: 2, attr: 'RW' },
  { name: 'max_chart_count', bits: 10, attr: 'RW' },
  { name: 'export_format_mask', bits: 4, attr: 'RW' },
  { name: 'last_error_code', bits: 16, attr: 'RO' },
  { name: 'retry_count', bits: 4, attr: 'RW' },
  { name: 'reserved', bits: 16 }
] }
```

## 43. 多域握手同步

```wavedrom
{ signal: [
  { name: 'src_clk', wave: 'p..................' },
  { name: 'dst_clk', wave: 'P.....P.....P.....' },
  { name: 'src_req', wave: '0.1.......0.......' },
  { name: 'src_toggle', wave: '0..1..............' },
  { name: 'sync_ff1', wave: '0.....1...........' },
  { name: 'sync_ff2', wave: '0........1........' },
  { name: 'dst_pulse', wave: '0........1.0......' },
  { name: 'dst_ack', wave: '0..........1.0....' },
  { name: 'src_done', wave: '0.............1.0.' }
] }
```

## 44. 多包乱序与重排

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p......................' },
  { name: 'issue_id', wave: 'x.=.=.=.=.=.x.........', data: ['0', '1', '2', '3', '4'] },
  { name: 'issue_valid', wave: '0.1.1.1.1.1.0.........' },
  { name: 'return_id', wave: 'x.........=.=.=.=.=.x', data: ['2', '0', '4', '1', '3'] },
  { name: 'return_valid', wave: '0.........1.1.1.1.1.0' },
  { name: 'reorder_full', wave: '0.....1.....0.........' },
  { name: 'commit_id', wave: 'x.............=.=.=.x', data: ['0', '1', '2'] }
] }
```

## 45. 复合状态寄存器

```wavedrom
{ reg: [
  { name: 'busy', bits: 1, attr: 'RO' },
  { name: 'dirty', bits: 1, attr: 'RO' },
  { name: 'mode', bits: 3, attr: 'RW' },
  { name: 'active_renderer', bits: 5, attr: 'RO' },
  { name: 'open_tabs', bits: 8, attr: 'RO' },
  { name: 'chart_errors', bits: 8, attr: 'R/W1C' },
  { name: 'last_duration_ms', bits: 16, attr: 'RO' },
  { name: 'reserved', bits: 22 }
] }
```

## 46. 超宽导出任务时序

```wavedrom
{ signal: [
  { name: 'clk', wave: 'p............................' },
  { name: 'open', wave: '0.1.0.......................' },
  { name: 'parse', wave: '0..1...0....................' },
  { name: 'render_vl', wave: '0....1.....0................' },
  { name: 'render_d2', wave: '0.....1......0..............' },
  { name: 'render_bpmn', wave: '0......1........0...........' },
  { name: 'capture', wave: '0...............1....0......' },
  { name: 'convert', wave: '0....................1...0..' },
  { name: 'save', wave: '0........................1.0' },
  { name: 'progress', wave: 'x.3.4.5.6.7.8.9.=.=.=.=.x', data: ['10%', '20%', '35%', '50%', '65%', '80%', '90%', '95%', '98%', '100%'] }
] }
```
