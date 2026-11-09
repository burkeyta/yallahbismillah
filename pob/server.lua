-- PoB engine server.
--
-- Runs inside Path of Building (PoE2)'s own "src" folder, under PoB's own LuaJIT
-- (pobhost.exe on Windows). Protocol, one message per line:
--   in  (stdin):  {"id":1,"cmd":"load","xml":"<PathOfBuilding2>..."}
--   out (stdout): @@{"id":1,"ok":true,...}
-- Everything PoB prints itself is sent to stderr so stdout stays clean.
--
-- Commands:
--   ping                     -> { ok }
--   load    { xml }          -> { ok, summary }
--   summary                  -> { ok, summary }
--   eval    { text }         -> { ok, item, results = [ { slot, replacing, before, after } ] }
--   selftest                 -> builds a tiny build in code, evaluates an item (used by CI)
--   export                   -> { ok, xml } the loaded build as Path of Building XML (used by CI)
--   quit

local stdout, stderr = io.stdout, io.stderr

-- keep PoB's own console output away from the protocol
local recent = { } -- last lines PoB printed, to explain a failed start
print = function(...)
	local parts = { }
	for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
	local line = table.concat(parts, "\t")
	stderr:write(line, "\n")
	table.insert(recent, line)
	if #recent > 12 then table.remove(recent, 1) end
end

local runtime = os.getenv("POB_RUNTIME") or "../runtime"
package.path = runtime .. "/lua/?.lua;" .. runtime .. "/lua/?/init.lua;" .. package.path
local windows = package.config:sub(1, 1) == "\\"
package.cpath = runtime .. (windows and "/?.dll;" or "/?.so;") .. package.cpath

local dkjson = require("dkjson")

local function reply(t)
	stdout:write("@@", dkjson.encode(t), "\n")
	stdout:flush()
end

-- HeadlessWrapper waits for Enter if PoB fails to start; that would eat our first request
local realRead = io.read
io.read = function() return nil end
local okStart, startErr = pcall(dofile, "HeadlessWrapper.lua")
io.read = realRead

if not okStart then
	reply({ id = 0, ready = false, error = "PoB failed to start: " .. tostring(startErr) })
	return
end
-- HeadlessWrapper stops early (without defining its helpers) when PoB shows a startup error
if type(newBuild) ~= "function" or type(loadBuildFromXML) ~= "function" or not build then
	local msg = table.concat(recent, " | "):gsub("%^%d", "")
	reply({ id = 0, ready = false, error = "PoB failed to start: " .. msg })
	return
end

---------------------------------------------------------------------------------------------
-- helpers

local function num(v)
	v = tonumber(v)
	if v == nil or v ~= v or v == math.huge or v == -math.huge then return nil end
	return v
end

-- the numbers we show, taken from a PoB output table
local function pick(o)
	o = o or { }
	local m = o.Minion or { }
	return {
		FullDPS = num(o.FullDPS),
		CombinedDPS = num(o.CombinedDPS),
		TotalDPS = num(o.TotalDPS),
		TotalDotDPS = num(o.TotalDotDPS),
		MinionDPS = num(m.CombinedDPS) or num(m.TotalDPS),
		AverageHit = num(o.AverageHit),
		Speed = num(o.Speed),
		CritChance = num(o.CritChance),
		CritMultiplier = num(o.CritMultiplier),
		HitChance = num(o.HitChance),
		Life = num(o.Life),
		EnergyShield = num(o.EnergyShield),
		Mana = num(o.Mana),
		Spirit = num(o.Spirit),
		Armour = num(o.Armour),
		Evasion = num(o.Evasion),
		Ward = num(o.Ward),
		BlockChance = num(o.BlockChance),
		TotalEHP = num(o.TotalEHP),
		MovementSpeedMod = num(o.MovementSpeedMod),
		FireResist = num(o.FireResist),
		ColdResist = num(o.ColdResist),
		LightningResist = num(o.LightningResist),
		ChaosResist = num(o.ChaosResist),
		FireResistOverCap = num(o.FireResistOverCap),
		ColdResistOverCap = num(o.ColdResistOverCap),
		LightningResistOverCap = num(o.LightningResistOverCap),
		ChaosResistOverCap = num(o.ChaosResistOverCap),
		-- how far below its maximum each resistance is (0 = capped)
		MissingFireResist = num(o.MissingFireResist),
		MissingColdResist = num(o.MissingColdResist),
		MissingLightningResist = num(o.MissingLightningResist),
		MissingChaosResist = num(o.MissingChaosResist),
		SpiritUnreserved = num(o.SpiritUnreserved),
		ManaUnreserved = num(o.ManaUnreserved),
		Str = num(o.Str),
		Dex = num(o.Dex),
		Int = num(o.Int),
	}
end

local function itemInfo(item)
	if not item then return nil end
	local req = item.requirements or { }
	return {
		name = item.name,
		title = item.title,
		baseName = item.baseName,
		rarity = item.rarity,
		type = item.type,
		req = { level = num(req.level), str = num(req.str), dex = num(req.dex), int = num(req.int) },
	}
end

local function mainSkillName()
	local list = build.skillsTab and build.skillsTab.socketGroupList or { }
	local group = list[build.mainSocketGroup or 1]
	if not group then return nil end
	local skills = group.displaySkillList
	local skill = skills and skills[group.mainActiveSkill or 1]
	if skill and skill.activeEffect and skill.activeEffect.grantedEffect then
		return skill.activeEffect.grantedEffect.name
	end
	return group.label ~= "" and group.label or nil
end

local function summary()
	local spec = build.spec or { }
	local out = build.calcsTab and build.calcsTab.mainOutput or { }
	return {
		className = spec.curClassName,
		ascendancy = spec.curAscendClassName,
		level = build.characterLevel,
		mainSkill = mainSkillName(),
		stats = pick(out),
	}
end

-- Gear slots an item can go in (what PoB's own item tooltip compares against)
local GEAR_SLOTS = { "Weapon 1", "Weapon 2", "Helmet", "Body Armour", "Gloves", "Boots", "Amulet",
	"Ring 1", "Ring 2", "Ring 3", "Belt", "Charm 1", "Charm 2", "Charm 3", "Flask 1", "Flask 2" }

local function candidateSlots(item)
	local itemsTab = build.itemsTab
	local env = build.calcsTab.mainEnv
	local weaponSet = env and env.weaponSet or 1
	local slots = { }
	local function consider(slotName, slot)
		if not slot or slot.inactive then return end
		if slot.weaponSet and slot.weaponSet ~= weaponSet then return end
		if not slot.weaponSet and slot.shown and not slot.shown() then return end
		local okValid, valid = pcall(itemsTab.IsItemValidForSlot, itemsTab, item, slotName)
		if okValid and valid then table.insert(slots, slotName) end
	end
	for _, slotName in ipairs(GEAR_SLOTS) do
		consider(slotName, itemsTab.slots[slotName])
	end
	-- jewels: every jewel socket allocated on the tree
	if item.type == "Jewel" then
		for slotName, slot in pairs(itemsTab.slots) do
			if slotName:match("^Jewel %d+$") then
				local nodeId = tonumber(slotName:match("%d+"))
				if build.spec.allocNodes and build.spec.allocNodes[nodeId] then
					consider(slotName, slot)
				end
			end
		end
	end
	return slots
end

local function load(xml)
	if type(xml) ~= "string" or xml == "" then return { ok = false, error = "No build XML" } end
	local okLoad, err = pcall(loadBuildFromXML, xml, "Build")
	if not okLoad then return { ok = false, error = "PoB could not load this build: " .. tostring(err) } end
	runCallback("OnFrame")
	if not (build.calcsTab and build.calcsTab.mainOutput) then
		return { ok = false, error = "PoB loaded the build but produced no output" }
	end
	return { ok = true, summary = summary() }
end

local function eval(text)
	if type(text) ~= "string" or text == "" then return { ok = false, error = "No item text" } end
	if not (build.calcsTab and build.calcsTab.mainOutput) then return { ok = false, error = "No build loaded" } end
	text = text:gsub("\r\n", "\n")
	local okItem, item = pcall(new, "Item", text)
	if not okItem or not item or not item.base then
		return { ok = false, error = "Path of Building doesn't recognise this item" .. (okItem and "" or (": " .. tostring(item))) }
	end
	pcall(item.NormaliseQuality, item)
	item:BuildModList()

	local calcFunc, base = build.calcsTab:GetMiscCalculator()
	local before = pick(base)
	local results = { }

	if item.base.flask or item.base.charm then
		-- flasks and charms: what having it active changes
		local override = item.base.flask and { toggleFlask = item } or { toggleCharm = item }
		local okCalc, out = pcall(calcFunc, override)
		if okCalc then
			table.insert(results, { slot = item.base.flask and "Flask" or "Charm", before = before, after = pick(out) })
		end
	else
		for _, slotName in ipairs(candidateSlots(item)) do
			local current = build.itemsTab.items[build.itemsTab.slots[slotName].selItemId]
			local okCalc, out = pcall(calcFunc, { repSlotName = slotName, repItem = item })
			if okCalc then
				table.insert(results, {
					slot = slotName,
					replacing = itemInfo(current),
					before = before,
					after = pick(out),
				})
			else
				stderr:write("calc failed for ", slotName, ": ", tostring(out), "\n")
			end
		end
	end
	if #results == 0 then
		return { ok = false, item = itemInfo(item), error = "This item doesn't fit any slot your build uses" }
	end
	return { ok = true, item = itemInfo(item), results = results }
end

local function selftest()
	newBuild()
	build.itemsTab:CreateDisplayItemFromRaw("Rarity: Rare\nTest Robe\nElementalist Robe\nEnergy Shield: 116\n+40 to maximum Life")
	build.itemsTab:AddDisplayItem(true)
	build.skillsTab:PasteSocketGroup("Spark 20/0  1")
	build.mainSocketGroup = 1
	runCallback("OnFrame")
	local r = eval([[
Item Class: Body Armours
Rarity: Rare
Gale Shell
Elementalist Robe
--------
Energy Shield: 180
--------
Item Level: 80
--------
+95 to maximum Life
+30% to Fire Resistance
]])
	r.summary = summary()
	return r
end

---------------------------------------------------------------------------------------------
-- main loop

reply({ id = 0, ready = true })

while true do
	local line = io.read("*l")
	if not line then break end
	line = line:gsub("\r$", "")
	if line ~= "" then
		local req = dkjson.decode(line)
		local res
		if type(req) ~= "table" then
			res = { ok = false, error = "Bad request" }
		else
			local okCmd, r = pcall(function()
				if req.cmd == "ping" then return { ok = true }
				elseif req.cmd == "load" then return load(req.xml)
				elseif req.cmd == "summary" then return { ok = true, summary = summary() }
				elseif req.cmd == "eval" then return eval(req.text)
				elseif req.cmd == "selftest" then return selftest()
				elseif req.cmd == "export" then return { ok = true, xml = build:SaveDB("Build") }
				elseif req.cmd == "quit" then return "quit"
				else return { ok = false, error = "Unknown command " .. tostring(req.cmd) } end
			end)
			if r == "quit" then break end
			res = okCmd and r or { ok = false, error = tostring(r) }
		end
		res.id = type(req) == "table" and req.id or nil
		reply(res)
	end
end
