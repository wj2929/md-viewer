# KaTeX 数学公式测试

## 1. 行内公式

爱因斯坦质能方程: $E = mc^2$

勾股定理: $a^2 + b^2 = c^2$

欧拉公式: $e^{i\pi} + 1 = 0$

行内分数: $\frac{1}{2} + \frac{1}{3} = \frac{5}{6}$

行内根号: $\sqrt{2} \approx 1.414$

---

## 2. 块级公式

### 二次方程求根公式

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

### 高斯积分

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

---

## 3. 希腊字母

$$
\alpha, \beta, \gamma, \delta, \epsilon, \zeta, \eta, \theta
$$

$$
\lambda, \mu, \nu, \xi, \pi, \rho, \sigma, \tau, \phi, \chi, \psi, \omega
$$

$$
\Gamma, \Delta, \Theta, \Lambda, \Xi, \Pi, \Sigma, \Phi, \Psi, \Omega
$$

---

## 4. 求和与连乘

### 求和

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

$$
\sum_{k=0}^{\infty} \frac{x^k}{k!} = e^x
$$

### 连乘

$$
\prod_{i=1}^{n} i = n!
$$

$$
\prod_{p \text{ prime}} \frac{1}{1-p^{-s}} = \zeta(s)
$$

---

## 5. 极限

$$
\lim_{x \to 0} \frac{\sin x}{x} = 1
$$

$$
\lim_{n \to \infty} \left(1 + \frac{1}{n}\right)^n = e
$$

---

## 6. 微分与偏导

$$
\frac{dy}{dx} = f'(x)
$$

$$
\frac{\partial f}{\partial x} + \frac{\partial f}{\partial y} = 0
$$

$$
\nabla f = \left(\frac{\partial f}{\partial x}, \frac{\partial f}{\partial y}, \frac{\partial f}{\partial z}\right)
$$

---

## 7. 积分

### 定积分

$$
\int_0^1 x^2 dx = \frac{1}{3}
$$

### 多重积分

$$
\iint_D f(x,y) \, dA = \int_a^b \int_c^d f(x,y) \, dy \, dx
$$

$$
\iiint_V \rho \, dV = M
$$

### 曲线积分

$$
\oint_C \mathbf{F} \cdot d\mathbf{r} = \iint_S (\nabla \times \mathbf{F}) \cdot d\mathbf{S}
$$

---

## 8. 三角函数

$$
\sin^2\theta + \cos^2\theta = 1
$$

$$
\tan\theta = \frac{\sin\theta}{\cos\theta}
$$

$$
e^{ix} = \cos x + i\sin x
$$

---

## 9. 对数与指数

$$
\log_a b = \frac{\ln b}{\ln a}
$$

$$
\ln(xy) = \ln x + \ln y
$$

$$
e^{\ln x} = x
$$

---

## 10. 矩阵

### 普通矩阵

$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

### 方括号矩阵

$$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$$

### 行列式

$$
\begin{vmatrix}
a & b \\
c & d
\end{vmatrix} = ad - bc
$$

### 单位矩阵

$$
I_3 = \begin{pmatrix}
1 & 0 & 0 \\
0 & 1 & 0 \\
0 & 0 & 1
\end{pmatrix}
$$

---

## 11. 方程组

### cases 环境

$$
f(x) = \begin{cases}
x^2 & \text{if } x \geq 0 \\
-x^2 & \text{if } x < 0
\end{cases}
$$

### aligned 环境

$$
\begin{aligned}
2x + 3y &= 7 \\
x - y &= 1
\end{aligned}
$$

---

## 12. 括号与定界符

### 自动调整大小

$$
\left( \frac{a}{b} \right) \quad \left[ \frac{a}{b} \right] \quad \left\{ \frac{a}{b} \right\}
$$

### 大括号

$$
\left\{ \sum_{i=1}^{n} x_i \right\}
$$

### 尖括号

$$
\langle x, y \rangle = \sum_i x_i y_i
$$

### 绝对值与范数

$$
|x| \quad \|x\| \quad \left| \frac{a}{b} \right|
$$

---

## 13. 上下标与修饰

### 帽子和波浪

$$
\hat{x} \quad \bar{x} \quad \tilde{x} \quad \vec{x} \quad \dot{x} \quad \ddot{x}
$$

### 上下划线

$$
\overline{AB} \quad \underline{text} \quad \overbrace{a+b+c}^{n} \quad \underbrace{x+y}_{2}
$$

---

## 14. 化学式（上下标组合）

水分子: $H_2O$

硫酸: $H_2SO_4$

化学反应: $2H_2 + O_2 \rightarrow 2H_2O$

离子: $Ca^{2+} + 2Cl^{-} \rightarrow CaCl_2$

---

## 15. 特殊符号

### 箭头

$$
\leftarrow \rightarrow \leftrightarrow \Leftarrow \Rightarrow \Leftrightarrow
$$

### 运算符

$$
\times \div \pm \mp \cdot \circ \bullet \oplus \otimes
$$

### 关系符号

$$
\leq \geq \neq \approx \equiv \sim \propto \subset \supset \in \notin
$$

### 省略号

$$
a_1, a_2, \ldots, a_n \quad a_1 + a_2 + \cdots + a_n
$$

---

## 16. 边界情况测试

### 空公式

$$$$

### 单字符

$x$

### 美元符号（非公式）

价格是 \$100（这不应该被解析为公式）

### 连续公式

$a$ $b$ $c$ 连续三个行内公式

### 复杂嵌套

$$
\sqrt{\frac{\sum_{i=1}^{n}(x_i - \bar{x})^2}{n-1}}
$$
