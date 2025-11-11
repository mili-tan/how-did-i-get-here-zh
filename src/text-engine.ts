import './env.js'
import { HETZNER_ASN, SERVER_HOST, SERVER_IP } from './env.js'
import type { ControllerResult_TraceDone, Hop, Hop_Done, Hop_FindingAsn, NetworkInfo, NetworkType } from './ktr-types.js'

interface Portion {
	key: {
		kind: 'Pending' | 'Done'
		networkInfo: NetworkInfo | null
	}
	hops: Exclude<Hop, Hop_FindingAsn>[]
	size: number
}

export function generateText(lastUpdate: ControllerResult_TraceDone) {
	const portions: Portion[] = []

	for (const hop of lastUpdate.hops) {
		const lastPortion = portions.at(-1)
		// 合并同为等待状态、相同ASN或相同组织的网络
		const keyMatches = lastPortion && lastPortion.key.kind === hop.kind
			&& (hop.kind === 'Pending'
				|| lastPortion.key.networkInfo?.asn === hop.networkInfo?.asn
				|| lastPortion.key.networkInfo?.network?.organization.id === hop.networkInfo?.network?.organization.id)

		if (keyMatches) {
			lastPortion.hops.push(hop)
		} else {
			portions.push({
				key: {
					kind: hop.kind,
					networkInfo: hop.kind === 'Done' ? hop.networkInfo : null
				},
				hops: [hop],
				get size() { return this.hops.length }
			})
		}
	}

	// 通过夹心合并或优先第一个部分来合并等待部分：
	// - <[Comcast]> <[Pending]> <[Comcast]> -> <[Comcast, Pending, Comcast]>)
	// - <[Comcast]> <[Pending]> <[Akamai]> -> <[Comcast, Pending]> <[Akamai]>
	for (let i = 0; i < portions.length - 2; i++) {
		const [ first, middle, last ] = portions.slice(i, i + 3)

		const canMerge = first.key.kind === 'Done' && middle.key.kind === 'Pending'
		const canSandwichMerge = first.key.networkInfo?.asn === last.key.networkInfo?.asn
			|| (first.key.networkInfo?.network && first.key.networkInfo?.network?.organization.id === last.key.networkInfo?.network?.organization.id)

		if (canMerge) {
			first.hops.push(...middle.hops)
			if (canSandwichMerge) {
				first.hops.push(...last.hops)
				portions.splice(i + 1, 2)
			} else {
				portions.splice(i + 1, 1)
			}
			i--
		}
	}

	// console.log(portions.map(p => p.hops.map(h => h.kind === 'Done' ? h.hostname ?? h.ip : '(pending)')))

	// 将最后一部分提取到单独的变量中
	const lastHops = portions.pop()!.hops
	let prevHop = portions[0].hops[0]

	// 开始文本生成
	const paragraphs: string[] = []
	let lastWasSideNote = false
	function pushParagraph(text: string) {
		lastWasSideNote = false
		paragraphs.push(text.trim().replace(/\s+/g, ' '))
	}

	const networkTypeCounts: Record<NetworkType, number> = {
		Nsp: 0,
		Content: 0,
		Isp: 0,
		NspOrIsp: 0,
		Enterprise: 0,
		Educational: 0,
		NonProfit: 0,
		Government: 0,
		RouteServer: 0,
		NetworkServices: 0,
		RouteCollector: 0,
		Other: 0
	}
	function describeNetworkType(networkType: NetworkType, needsArticle: boolean) {
		const count = networkTypeCounts[networkType]
		networkTypeCounts[networkType]++
		
		let long: string  // 完整名称，包括冠词("an"或"a")
		let short: string // 仅缩写或单词
		let shortArticle: string | null   // 伴随short的冠词，如果必须使用long则为null
		let shortSupportsAnother: boolean // short是否支持"another"作为前缀

		switch (networkType) {
			case 'Nsp': {
				long = '一个网络服务提供商，一家向其他公司销售互联网接入的公司'
				short = 'NSP'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'Content': {
				long = '一个内容分发网络'
				short = 'CDN'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'Isp': {
				long = '一个互联网服务提供商'
				short = 'ISP'
				shortArticle = 'an'
				shortSupportsAnother = true
				break
			}
			case 'NspOrIsp': {
				long = '要么是一个ISP，要么是向其他公司销售互联网接入的提供商'
				short = 'NSP/ISP'
				shortArticle = 'an'
				shortSupportsAnother = true
				break
			}

			case 'Enterprise': {
				long = `一个大型企业网络`
				short = 'enterprise'
				shortArticle = 'an'
				shortSupportsAnother = false
				break
			}
			case 'Educational': {
				long = '某个教育机构'
				short = 'edu'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return '另一个教育机构'
				break
			}
			case 'NonProfit': {
				long = '一个非营利组织拥有的网络'
				short = 'nonprofit'
				shortArticle = 'a'
				shortSupportsAnother = false
				break
			}
			case 'Government': {
				long = '一个政府拥有的网络'
				short = 'government'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return '另一个政府网络'
				break
			}

			case 'RouteServer': {
				long = '与路由服务器关联，它帮助管理BGP会话但不一定拥有自己的网络'
				short = 'route server'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}
			case 'NetworkServices': {
				long = '一个网络基础设施提供商'
				short = 'infrastructure'
				shortArticle = null
				shortSupportsAnother = false
				if (needsArticle && count === 1) return '另一个基础设施提供商'
				break
			}
			case 'RouteCollector': {
				long = '一个路由收集器，一个只尝试接收所有BGP路由的网络'
				short = 'route collector'
				shortArticle = 'a'
				shortSupportsAnother = true
				break
			}

			case 'Other': {
				if (needsArticle) {
					return `我找不到太多相关信息`
				} else {
					return '???'
				}
			}
		}

		if (count === 0) {
			return long
		} else if (count === 1 && shortSupportsAnother) {
			return '另一个 ' + short
		} else if (needsArticle) {
			return shortArticle + ' ' + short
		} else {
			return short
		}
	}

	let unknownNetworkCount = 0
	function describePortionTersely(portion: Portion) {
		const network = portion.key.networkInfo?.network
		if (network) {
			return `${network.name.trim()} (${describeNetworkType(network.networkType, false)})`
		} else if (portion.key.networkInfo) {
			return `AS${portion.key.networkInfo.asn} (???)`
		} else {
			unknownNetworkCount++
			if (unknownNetworkCount === 1) {
				return '一个未识别的网络'
			} else {
				return '另一个未识别的网络'
			}
		}
	}

	function areNamesSimilar(a: string, b: string): boolean {
		return a.trim() === b.trim()
			|| b.includes(a.trim())
			|| a.includes(b.trim())
	}

	function firstSegment(portion: Portion, includesFirst: boolean, thatRouter: boolean) {
		isStraightEntryFromIsp = false
		prevHop = portion.hops.at(-1)!
		if (portion.key.networkInfo && portion.key.networkInfo.network) {
			const network = portion.key.networkInfo.network

			const uniqueNetworks = new Set<number>()
			for (const hop of portion.hops) if (hop.kind === 'Done' && hop.networkInfo?.network) uniqueNetworks.add(hop.networkInfo.network.id)

			let text = ''
			text += includesFirst ? `从 ` : `从 `
			text += thatRouter ? '那个路由开始，' : '你的路由开始，'
			text += '你的旅程的第一部分经过了'
			text += portion.size === 1 ? '一个设备 ' : '多个设备 '
			text += `在${network.organization.name.trim()}的`
			text += uniqueNetworks.size <= 1 ? '网络中' : '多个网络中'
			if (!areNamesSimilar(network.name, network.organization.name)) text += `，${network.name.trim()}`
			text += '。'

			if (network.networkType === 'Isp') {
				networkTypeCounts['Isp']++
				text += `那很可能是你的ISP，负责通过收费将你连接到互联网。`
			} else if (network.networkType === 'Nsp' || network.networkType === 'NspOrIsp') {
				networkTypeCounts['Isp']++ // 不是拼写错误
				text += `那要么是你的ISP，负责通过收费将你连接到互联网，要么是你的互联网提供商签约的公司。`
			} else {
				text += `
					那是我能找到信息的第一个网络；很可能处理你互联网接入的人正在向他们付费
					获取互联网接入，或者他们是你的VPN提供商。
				`
			}

			pushParagraph(text)
		} else if (portion.key.networkInfo) {
			pushParagraph(`
				你的旅程的第一部分经过了${portion.size === 1 ? '一个设备' : '多个设备'}在网络
				AS${portion.key.networkInfo.asn}中。我除了它的自治系统号码外找不到任何相关信息，
				但很可能处理你互联网接入的人正在向他们付费获取互联网接入，或者他们是你的VPN提供商。
			`)
		} else {
			pushParagraph(`
				在${thatRouter ? '那个' : '你的'}路由之后，你经过了一个未识别网络中的${portion.size === 1 ? '一个设备' : '一些设备'}，
				很可能是在你计算机连接的任何网络内部。
			`)
		}
		clarifyNoResponseIfNeeded(portion.hops, false)
	}

	let didClarifyHostname = false
	function clarifyHostname(hop: Hop_Done) {
		if (didClarifyHostname) return
		pushParagraph(`
			（旁注，那个${hop.hostname}是我通过反向DNS查找的结果，我询问我的DNS服务器
			是否有任何名称与追踪路由中实际返回的IP ${hop.ip}相关联。由于有，我使用了"美观的"人类可读的
			名称而不是数字。反向DNS名称通常只是为了更容易调试而设计，而且通常
			甚至无法映射回原始IP。）
		`)
		lastWasSideNote = true
		didClarifyHostname = true
	}

	let didClarifyNoResponse = false
	function clarifyNoResponseIfNeeded(hops: Hop[], isNextProbe: boolean) {
		if (didClarifyNoResponse) return
		if (hops.some(h => h.kind === 'Pending')) {
			pushParagraph(`
				${isNextProbe ? `我们实际上没有从下一个探测得到响应。` : `顺便说一下，看到那个"(无响应)"了吗？`}
				追踪路由中经常会有一些这样的——不是每个服务器都会持续响应我们，
				而且互联网是不可靠的！这很遗憾，但我们仍然可以从确实响应的服务器中
				很好地了解发生了什么。
			`)
			lastWasSideNote = true
			didClarifyNoResponse = true
		}
	}
	
	// 开始和第一段
	let isStraightEntryFromIsp = true
	{
		const portion = portions.shift()!
		
		const user = portion.hops.shift()!
		if (user.kind === 'Pending') {
			pushParagraph(`
				这个旅程始于你的计算机与你的路由通信。那个路由，你进入ISP网络的入口点，
				实际上没有响应我的ping——这对于公共路由或者如果你在VPN后面是很常见的——所以我们
				只能在追踪路由的开头想象它的存在。
			`)
			// 注意：在追踪路由的开头永远不可能有第二个等待的hop，它们事先被修剪了。
			const nextPortion = portions.shift()
			if (nextPortion) firstSegment(nextPortion, false, false)
		} else { // Done
			if (user.networkInfo?.network?.networkType === 'Isp') {
				pushParagraph(`
					这个旅程始于你的计算机与你的路由通信。那个路由，你进入ISP
					网络的入口点，是你在追踪路由中会看到的第一个项目${user.hostname ? '并且与' : '以及'}
					你的公共IP：${user.ip}相关联。
				`)
			} else {
				pushParagraph(`
					这个旅程始于你的计算机与你的路由通信。那个路由，你进入互联网的入口点，
					可能是你在追踪路由中看到的第一个项目（${user.hostname ? '与' : '以及'}你的
					公共IP，${user.ip}）。或者，你可能在某种VPN后面——在这种情况下，我们能追踪到的最早点
					是你的数据包正在通过的面向互联网的路由。
				`)
			}
			
			if (portion.size === 0) { // 只有第一个hop在这个部分中
				const nextPortion = portions.shift()
				if (nextPortion) firstSegment(nextPortion, false, true)
			} else { // >= 1 剩余
				firstSegment(portion, true, true)
			}
		}
	}

	// 这很愚蠢，但从现在开始我们只关心网络级别，而不是组织级别，
	// 所以我们必须按ASN重新分块
	for (let i = 0; i < portions.length; i++) {
		for (let j = 1; j < portions[i].hops.length; j++) {
			const hop = portions[i].hops[j]
			if (hop.kind === 'Done' && hop.networkInfo?.asn !== portions[i].key.networkInfo?.asn) {
				const remainingHops = portions[i].hops.splice(j)
				portions.splice(i + 1, 0, {
					key: hop,
					hops: remainingHops,
					get size() { return this.hops.length }
				})
			}
		}
	}
	
	// 中间段
	let intermediates: '0' | '1-3' | '4+' = '0'
	{
		if (!isStraightEntryFromIsp && portions[0]?.key?.kind === 'Pending') {
			clarifyNoResponseIfNeeded(portions.shift()!.hops, true)
		}

		const doneRemaining = portions.filter(portion => portion.key.kind === 'Done')
		if (doneRemaining.length === 1) {
			intermediates = '1-3'
			const network = doneRemaining[0].key.networkInfo?.network

			let prefix
			let description
			if (network) {
				const [ netName, orgName ] = [ network.name.trim(), network.organization.name.trim() ]
				if (areNamesSimilar(netName, orgName)) {
					prefix = `你通过${netName}进行了一个中间跳跃`
					description = describeNetworkType(network.networkType, true)
				} else {
					prefix = `你通过${netName}进行了一个中间跳跃，这是一个由${orgName}拥有的网络`
					description = describeNetworkType(network.networkType, true)
				}
			} else {
				prefix = `你通过AS${doneRemaining[0].key.networkInfo!.asn}进行了一个中间跳跃`
				description = describeNetworkType('Other', true)
			}

			if (description.includes(',')) {
				pushParagraph(`${prefix}。他们是${description}。`)
			} else {
				pushParagraph(`${prefix}，${description}。`)
			}
		} else if (doneRemaining.length === 2) {
			intermediates = '1-3'
			pushParagraph(`
				接下来，你跳过了两个网络：${describePortionTersely(doneRemaining[0])}和${describePortionTersely(doneRemaining[1])}。
			`)
		} else if (doneRemaining.length >= 3) {
			intermediates = '1-3'
			if (doneRemaining.length >= 4) intermediates = '4+'
			pushParagraph(`
				接下来，你经过了一条漫长而曲折的路径，通过了${doneRemaining.slice(0, -1).map(describePortionTersely).join('、')}，
				${doneRemaining.length >= 4 ? '最后' : '和'}${describePortionTersely(doneRemaining.at(-1)!)}。
			`)
		}

		for (const portion of portions) {
			if (!isStraightEntryFromIsp && portion === portions.at(-1)) { // 还不是最后一个，因为这可能是到结束的过渡
				clarifyNoResponseIfNeeded(portion.hops, false)
			}
			isStraightEntryFromIsp = false
			if (portion.key.kind === 'Done') prevHop = portion.hops.at(-1)!
		}
	}

	// 结束
	{
		function isServer(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.ip === SERVER_IP && hop.hostname === SERVER_HOST
		}
		function isHetznerEntrypoint(hop: Hop): hop is Hop_Done {
			return hop.kind === 'Done' && hop.networkInfo?.asn === HETZNER_ASN && !isServer(hop)
		}

		const getPrefix = () => isStraightEntryFromIsp
			? '总之'
			: {
				'0':   `${lastWasSideNote ? '总之，在' : '在'}几次跳跃之后`,
				'1-3': '最终',
				'4+':  '在所有这些之后',
			}[intermediates]
		if (isHetznerEntrypoint(lastHops[0])) {
			// 简单，我们有Hetzner入口点
			
			if (!isStraightEntryFromIsp) {
				clarifyNoResponseIfNeeded((portions.at(-1)?.hops ?? []).slice(-1), true)
			}
			clarifyNoResponseIfNeeded(lastHops, false)

			const prevNetworkName = (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.name.trim?.())
				|| (prevHop.kind === 'Done' && prevHop.networkInfo?.network?.asn && 'AS' + prevHop.networkInfo.network.asn)
				|| '那个网络'

			pushParagraph(`
				${getPrefix()}，你需要离开${prevNetworkName}的领域
				才能到达我的服务器。
				我使用Hetzner作为托管提供商，你进入他们网络的入口点是${lastHops[0].hostname ?? lastHops[0].ip}。
				从那里，你在Hetzner的内部网络中被跳转了几次，最终到达我的服务器。
			`)
			if (lastHops[0].hostname) clarifyHostname(lastHops[0])
		} else {
			// 我们没有Hetzner端点
			
			let unknownHopCount = 0
			while (lastHops.at(-1 - unknownHopCount)?.kind === 'Pending') unknownHopCount++

			pushParagraph(`
				${getPrefix()}，我们有${didClarifyNoResponse ? '另一个' : '一个'}没有响应的探测。
				${unknownHopCount >= 2 ? '其中之一' : '这'}很可能是你进入Hetzner网络的入口点（他们是我的托管提供商）。
				从那里，你在Hetzner的内部网络中被跳转了几次，最终到达我的服务器。
			`)
		}
	}

	return paragraphs
}

export function generateEssayTracerouteInfo(hops: Hop[]) {
	const hopAsns = hops
		.map(hop => hop.kind === 'Done' ? hop.networkInfo?.asn ?? null : null)
		.filter(asn => asn !== null) as number[]

	// 计算不同网络的频率
	const frequency: Record<number, number> = {}
	for (let i = 0; i < hopAsns.length; i++) frequency[hopAsns[i]] = (frequency[hopAsns[i]] ?? 0) + 1

	// 获取频率最高的ASN
	let highestFrequency = 0
	let highestFrequencyAsn: number | null = null
	for (const [ asn, freq ] of Object.entries(frequency)) {
		if (Number(asn) === HETZNER_ASN) continue
		if (freq > highestFrequency) {
			highestFrequency = freq
			highestFrequencyAsn = Number(asn)
		}
	}
	if (highestFrequency <= 2) {
		// 再次尝试但允许Hetzner（是的，我知道这可能是不好的代码）
		for (const [ asn, freq ] of Object.entries(frequency)) {
			if (freq > highestFrequency) {
				highestFrequency = freq
				highestFrequencyAsn = Number(asn)
			}
		}
	}

	// 找到那个ASN的网络信息
	let highestFrequencyNetworkInfo: NetworkInfo | null = null
	for (const hop of hops) {
		if (hop.kind === 'Done' && hop.networkInfo?.asn === highestFrequencyAsn) {
			highestFrequencyNetworkInfo = hop.networkInfo
			break
		}
	}
	const cardinals = [ '一', '二', '三', '四', '五', '六', '七', '八', '九' ]
	const showHighestFrequencyNetwork = highestFrequency >= 2
	const highestFrequencyNetworkName = highestFrequencyNetworkInfo?.network?.name.trim() ?? ('AS' + highestFrequencyAsn)
	const highestFrequencyNetworkCount = (highestFrequency <= 3 ? '这 ' : '所有 ')
		+ (cardinals[highestFrequency - 1] ?? highestFrequency.toString())

	// 去重
	for (let i = 0; i < hopAsns.length - 1; i++) {
		if (hopAsns[i] === hopAsns[i + 1]) {
			hopAsns.splice(i, 1)
			i--
		}
	}
	
	const hopAsnStrings = hopAsns.map(asn => 'AS' + asn)
	
	let connection: [string, string] | null = null
	for (let i = 0; i < hopAsns.length - 1; i++) {
		if (hopAsns[i] && hopAsns[i + 1]) {
			connection = [ 'AS' + hopAsns[i], 'AS' + hopAsns[i + 1] ]
			break
		}
	}

	return {
		hopAsnStrings,
		connection,
		showHighestFrequencyNetwork,
		highestFrequencyNetworkName,
		highestFrequencyNetworkCount
	}
}
