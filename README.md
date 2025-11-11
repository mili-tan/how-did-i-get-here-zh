<div align='center'>
<a href='https://how-did-i-get-here.net/'>
<img width='700' src='src/static/github-header.svg' alt='How Did I Get Here? Lexi Mattick 和 Hack Club 的项目'>
<p><strong>访问 how-did-i-get-here.net &raquo;</strong></p>
</a>
</div>

---

一个关于互联网路由如何工作的工具/网站/文章。

在加载时，它会运行一个追踪路由到你的公共IP，加载ASN和PeeringDB信息，并通过HTTP实时流式传输结果。然后，500行if语句渲染出一篇生成式文章，描述你的追踪路由所覆盖的网络来源路径。最后，我还包含了一篇关于追踪路由程序如何工作以及什么是BGP的额外文章。

追踪路由和所有查找都由我用Rust从头编写的自定义追踪路由库和代理[ktr](https://github.com/kognise/ktr/)提供支持。它被设计成非常容错和高并发，使其适合在这样的网站环境中使用！

![](https://doggo.ninja/F5uEIx.png)

我尝试过使用Bun，但Node HTTP套接字支持不够全面，所以我将其移植回了普通的Node with TypeScript。这种情况似乎总是发生。不过，我仍然使用Bun作为包管理器，因此有bun.lockb！我选择了一种混合方法（读作：我随意开发了这个项目），其中复杂、可靠的代码都是TypeScript，但入口点实际上是一个JavaScript文件，可以毫无问题地进行灵活的对象操作！

我的HTTP流式传输方法有点取巧。它先发送用EJS渲染的页面前半部分（在用于分割的注释之前）。然后，它一遍又一遍地流式传输另一个EJS片段，用一个通过CSS隐藏前一片段的style标签分隔。当追踪路由完成流式传输时，它渲染并发送文件的其余部分。这让我可以在没有JavaScript*或*太多复杂性的情况下流式传输整个UI片段 :)

我没有什么其他内容可以放在这个README里了，但你应该[查看实际网站](https://how-did-i-get-here.net/)，因为它比阅读关于它的内容要酷得多！
