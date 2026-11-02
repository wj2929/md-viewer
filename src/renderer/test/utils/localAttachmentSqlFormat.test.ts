import { describe, expect, it } from 'vitest'
import { formatAttachmentSql } from '../../src/utils/localAttachmentSqlFormat'

describe('SQL附件有限格式化', () => {
  it.each([
    "select id, '已完成' as status, 9007199254740993123 as total from orders where id=:id and enabled=true;",
    'with recent as (select id from orders where total>42) select * from recent;',
    "insert into t (id,name) values (1,'a');update t set name='b' where id=1;delete from t where id=1;",
    'create table x (id integer, name varchar(20)); select * from x;',
    "select o.id,u.name from orders o left join users u on u.id=o.user_id where o.id=?;",
  ])('排版常见查询且可重复格式化：%s', source => {
    const result = formatAttachmentSql(source)
    expect(result.reason).toBeUndefined()
    expect(result.content).toContain('\n')
    expect(formatAttachmentSql(result.content)).toEqual(result)
  })

  it('保留大小写、大整数、负零、普通小数、引号、中文和参数', () => {
    const source = `select 'it''s -- 文本', "a""b", N'你好', -0, 123.4500, 9007199254740993123 from t where a=? and b=$1 and c=:name and d=@name;`
    const result = formatAttachmentSql(source)
    expect(result.reason).toBeUndefined()
    for (const literal of ["'it''s -- 文本'", '"a""b"', "N'你好'", '-0', '123.4500', '9007199254740993123', '?', '$1', ':name', '@name', 'select']) expect(result.content).toContain(literal)
  })

  it('精确保留多行块注释与行注释，注释后的语句仍在新行', () => {
    const comment = '/* 说明\n   KEEP indent\n other */'
    const source = `${comment}\nselect a, /* inline */ b from t -- trailing\nwhere id=1; -- end`
    const result = formatAttachmentSql(source)
    expect(result.reason).toBeUndefined()
    expect(result.content).toContain(comment)
    expect(result.content).toContain('/* inline */')
    expect(result.content).toMatch(/-- trailing\r?\nwhere/)
    expect(result.content).toContain('-- end')
  })

  it.each([
    "select $$a  b$$;", "select $tag$x;y$tag$;", "select q'[x y]';",
    'create procedure p() begin select 1; end;', 'DELIMITER $$\nselect 1$$',
    'select 1 /* outer /* inner */ outer */;', 'select /* unclosed', "select 'unclosed",
    'select "unclosed', 'select (1;', 'select 1);', "select 'a'\n'b';", "select 'a' /* between */ 'b';",
    String.raw`select E'a\nb';`, 'select 1.00e+400;', 'select 1e3;', 'select x::text from t;',
    "select a->>'x' from t;", 'select 1; --\nselect 2;', 'select 1;--',
  ])('不可靠结构完整回退：%s', source => {
    expect(formatAttachmentSql(source)).toEqual({ content: source, reason: 'unsupported' })
  })

  it('输入、token、深度或输出预算超限时不截断原文', () => {
    for (const source of ['x'.repeat(128 * 1024 + 1), '中'.repeat(44_000), 'select 1; '.repeat(2500), 'select ' + '('.repeat(65) + '1' + ')'.repeat(65), 'select ' + '('.repeat(64) + 'select ' + 'a,'.repeat(2500) + 'a' + ')'.repeat(64)]) {
      expect(formatAttachmentSql(source)).toEqual({ content: source, reason: 'budget' })
    }
  })
})
