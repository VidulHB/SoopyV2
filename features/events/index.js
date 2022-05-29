/// <reference types="../../../CTAutocomplete" />
/// <reference lib="es2015" />
import { m } from "../../../mappings/mappings";
import Feature from "../../featureClass/class";
import socketConnection from "../../socketConnection";
import { drawBoxAtBlock, drawBoxAtBlockNotVisThruWalls, drawCoolWaypoint, drawLine } from "../../utils/renderUtils";
import { calculateDistanceQuick } from "../../utils/utils";
import SettingBase from "../settings/settingThings/settingBase";
import ToggleSetting from "../settings/settingThings/toggle";
import { fetch } from "../../utils/networkUtils"

class Events extends Feature {
	constructor() {
		super()
	}

	onEnable() {
		this.initVariables()

		this.burrialData = {
			points: [],
			locations: [],
			historicalLocations: []
		}
		this.lastWorldChange = 0
		this.lastRequest = 0
		this.potentialParticleLocs = {}
		this.showingWaypoints = false
		this.lastPath = []
		this.updatingPath = false
		this.lastPathCords = undefined


		this.loadFromParticles = new ToggleSetting("Load burrials from particles", "Will load particles from burrows in the world", true, "burrial_from_partles", this)
		this.showBurrialGuess = new ToggleSetting("Estimate burrial location from ability", "Will show a line + box where it thinks the burrial is", true, "burrial_guess", this)
		new SettingBase("NOTE: You must have music disabled for burrial guessess to work", "/togglemusic", false, "burrial_guess_into", this).requires(this.showBurrialGuess)

		this.otherInquisWaypoints = new ToggleSetting("Show other users inquis locations", "May be usefull for loot share", true, "inquis_location_other", this)

		this.shinyBlocks = []

		this.lastDing = 0
		this.lastDingPitch = 0
		this.firstPitch = 0
		this.lastParticlePoint = undefined
		this.firstParticlePoint = undefined
		this.particlePoint = undefined
		this.guessPoint = undefined
		this.distance = undefined
		this.dingIndex = 0
		this.dingSlope = []

		this.slayerLocationDataH = {}
		this.todoE = []


		this.shinyBlockOverlayEnabled = new ToggleSetting("Shiny blocks highlight", "Will highlight shiny blocks in the end", false, "shiny_blocks_overlay", this)

		this.registerEvent("worldLoad", this.worldLoad)
		this.registerEvent("spawnParticle", this.spawnParticle).registeredWhen(() => this.showingWaypoints)
		this.registerEvent("renderWorld", this.renderWorld).registeredWhen(() => this.showingWaypoints || this.shinyBlockOverlayEnabled.getValue())
		this.registerStep(true, 2, this.step)
		this.registerStep(false, 5, this.step_5s)

		this.registerEvent("soundPlay", this.playSound).registeredWhen(() => this.showingWaypoints)
		this.registerForge(net.minecraftforge.event.entity.EntityJoinWorldEvent, this.entityJoinWorldEvent).registeredWhen(() => this.showingWaypoints);

		this.registerChat("&r&eYou dug out a Griffin Burrow! &r&7(${*}/4)&r", this.burrialClicked)
		this.registerChat("&r&eYou finished the Griffin burrow chain! &r&7(4/4)&r", this.burrialClicked)
		this.inquisWaypointSpawned = false
	}

	entityJoinWorldEvent(e) {
		this.todoE.push(e.entity);
	}

	inquisData(loc, user) {
		if (!loc) {
			delete this.slayerLocationDataH[user]
			return
		}
		this.slayerLocationDataH[user] = [loc, Date.now()]
	}

	renderWorld(ticks) {
		this.shinyBlocks.forEach(([loc]) => {
			drawBoxAtBlockNotVisThruWalls(loc[0], loc[1], loc[2], 0, 255, 0, 0.1, 0.1)
		})
		if (this.showingWaypoints) {
			if (this.guessPoint && this.showBurrialGuess.getValue()) {
				drawCoolWaypoint(this.guessPoint[0], this.guessPoint[1], this.guessPoint[2], 255, 255, 0, { name: "§eGuess" })
			}
			this.burrialData.locations.forEach((loc, i) => {

				let typeReplace = [
					"Start",
					"Mob",
					"Treasure",
					"Finish",
					"Unknown"
				]
				if (!loc.clicked) {
					blue = false
					if (loc.lastPing && Date.now() - loc.lastPing < 500) {
						blue = true
					}

					let name = ""

					if (loc.fromApi) {
						name = (loc.nearest ? "§c" : "§a") + "(" + (loc.chain + 1) + "/4) " + typeReplace[loc.type] + " burrial"
					} else {
						name = (loc.nearest ? "§c" : "§a") + typeReplace[loc.type] + " burrial"
					}

					drawCoolWaypoint(loc.x, loc.y, loc.z, 0, blue ? 100 : 255, blue ? 255 : 0, { name: name })
				}
			})
		}

		if (this.otherInquisWaypoints.getValue()) {
			Object.keys(this.slayerLocationDataH).forEach(key => {
				drawCoolWaypoint(this.slayerLocationDataH[key][0][0], this.slayerLocationDataH[key][0][1], this.slayerLocationDataH[key][0][2], 255, 0, 0, { name: key + "'s inquis" })
			})
		}
	}

	sortBurrialLocations() {
		let sorted = [...this.burrialData.locations]
		sorted.sort((a, b) => {
			let aDist = calculateDistanceQuick([Player.getX(), Player.getY(), Player.getZ()], [a.x + 0.5, a.y + 2.5, a.z + 0.5])
			let bDist = calculateDistanceQuick([Player.getX(), Player.getY(), Player.getZ()], [b.x + 0.5, b.y + 2.5, b.z + 0.5])

			return bDist - aDist
		})
		this.burrialData.locations = sorted
	}

	step() {
		if (!Player.getInventory()) return

		hasDianaShovle = false
		let slots = [0, 1, 2, 3, 4, 5, 6, 7, 8]
		slots.forEach(a => {
			item = Player.getInventory().getStackInSlot(a)
			if (!item) return
			if (ChatLib.removeFormatting(item.getName()) === "Ancestral Spade") {
				hasDianaShovle = true
			}
		})

		let showingWaypointsNew = (this.lastWorldChange + 5000 < Date.now() ? hasDianaShovle && this.FeatureManager.features["dataLoader"].class.area === "Hub" && (this.loadFromParticles.getValue() || this.showBurrialGuess.getValue()) : this.showingWaypoints || (hasDianaShovle && this.FeatureManager.features["dataLoader"].class.area === "Hub" && (this.loadFromParticles.getValue() || this.showBurrialGuess.getValue())))

		this.showingWaypoints = showingWaypointsNew

		this.shinyBlocks = this.shinyBlocks.filter(([loc, time]) => {
			return time > Date.now() - 5000
		})


		Object.keys(this.slayerLocationDataH).forEach(n => {
			if (this.slayerLocationDataH[n][1] + 60000 * 3 < Date.now()) {
				delete this.slayerLocationDataH[n]
			}
		})

		this.todoE.forEach(e => {
			e = new Entity(e)
			if (e.getName().toLowerCase().includes("inquis") && Math.abs(e.getY() - Player.getY()) < 10 && Math.abs(e.getX() - Player.getX()) < 10 && Math.abs(e.getZ() - Player.getZ()) < 10) {
				socketConnection.sendInquisData({ loc: [Math.round(Player.getX()), Math.round(Player.getY()), Math.round(Player.getZ())] });
				this.inquisWaypointSpawned = true
			}
		})
		this.todoE = []
	}

	step_5s() {
		this.sortBurrialLocations()
	}

	worldLoad() {
		this.burrialData.points = []
		this.burrialData.locations = []
		this.burrialData.historicalLocations = []
		this.lastDing = 0
		this.lastDingPitch = 0
		this.firstPitch = 0
		this.lastParticlePoint = undefined
		this.lastParticlePoint2 = undefined
		this.lastSoundPoint = undefined
		this.firstParticlePoint = undefined
		this.particlePoint = undefined
		this.guessPoint = undefined
		this.distance = undefined
		this.dingIndex = 0
		this.dingSlope = []

		this.lastPath = undefined
		this.lastPathCords = undefined

		this.lastWorldChange = Date.now()
	}

	playSound(pos, name, volume, pitch, categoryName, event) {
		if (!this.showBurrialGuess.getValue()) return
		// if (this.dingIndex > 13) return
		// if (pos.getX() === Math.floor(Player.getX() * 8) / 8 && pos.getZ() === Math.floor(Player.getZ() * 8) / 8) return
		if (name !== "note.harp") return
		if (this.lastDing === 0) {
			this.firstPitch = pitch
		}
		this.lastDing = Date.now()
		if (pitch < this.lastDingPitch) {
			this.firstPitch = pitch
			this.dingIndex = 0
			this.dingSlope = []
			this.lastDingPitch = pitch
			this.lastParticlePoint = undefined
			this.lastParticlePoint2 = undefined
			this.lastSoundPoint = undefined
			this.firstParticlePoint = undefined
		}
		if (this.lastDingPitch === 0) {
			this.lastDingPitch = pitch
			this.lastParticlePoint = undefined
			this.lastParticlePoint2 = undefined
			this.lastSoundPoint = undefined
			this.firstParticlePoint = undefined
			return
		}
		this.dingIndex++
		if (this.dingIndex > 1) this.dingSlope.push(pitch - this.lastDingPitch)
		if (this.dingSlope.length > 15) this.dingSlope.shift()
		let slope = this.dingSlope.reduce((a, b) => a + b, 0) / this.dingSlope.length
		// console.log(this.dingSlope.join(","))
		this.lastSoundPoint = [pos.getX(), pos.getY(), pos.getZ()]
		this.lastDingPitch = pitch

		if (!this.lastParticlePoint2 || !this.particlePoint || !this.firstParticlePoint) return
		this.distance = Math.E / slope - Math.hypot(this.firstParticlePoint[0] - pos.getX(), this.firstParticlePoint[1] - pos.getY(), this.firstParticlePoint[2] - pos.getZ())
		// console.log(this.dingIndex + "	" + this.dingSlope / this.dingIndex + "	" + pitch + "	" + (pitch - this.lastDingPitch))


		let lineDist = Math.hypot(this.lastParticlePoint2[0] - this.particlePoint[0], this.lastParticlePoint2[1] - this.particlePoint[1], this.lastParticlePoint2[2] - this.particlePoint[2])
		let distance = this.distance
		let changes = [this.particlePoint[0] - this.lastParticlePoint2[0], this.particlePoint[1] - this.lastParticlePoint2[1], this.particlePoint[2] - this.lastParticlePoint2[2]]
		changes = changes.map(a => a / lineDist)
		this.guessPoint = [this.lastSoundPoint[0] + changes[0] * distance, this.lastSoundPoint[1] + changes[1] * distance, this.lastSoundPoint[2] + changes[2] * distance]
	}

	spawnParticle(particle, type, event) {
		if (this.showingWaypoints && this.showBurrialGuess.getValue() && particle.toString().startsWith("EntityDropParticleFX,")) {
			let run = false
			if (this.lastSoundPoint && !run && Math.abs(particle.getX() - this.lastSoundPoint[0]) < 2 && Math.abs(particle.getY() - this.lastSoundPoint[1]) < 0.5 && Math.abs(particle.getZ() - this.lastSoundPoint[2]) < 2) {
				run = true
			}
			if (run) {
				if (this.lastParticlePoint === undefined) {
					this.firstParticlePoint = [particle.getX(), particle.getY(), particle.getZ()]
				}
				this.lastParticlePoint2 = this.lastParticlePoint
				this.lastParticlePoint = this.particlePoint
				this.particlePoint = [particle.getX(), particle.getY(), particle.getZ()]

				if (!this.lastParticlePoint2 || !this.particlePoint || !this.firstParticlePoint || !this.distance || !this.lastSoundPoint) return

				let lineDist = Math.hypot(this.lastParticlePoint2[0] - this.particlePoint[0], this.lastParticlePoint2[1] - this.particlePoint[1], this.lastParticlePoint2[2] - this.particlePoint[2])
				let distance = this.distance
				let changes = [this.particlePoint[0] - this.lastParticlePoint2[0], this.particlePoint[1] - this.lastParticlePoint2[1], this.particlePoint[2] - this.lastParticlePoint2[2]]
				changes = changes.map(a => a / lineDist)
				this.guessPoint = [this.lastSoundPoint[0] + changes[0] * distance, this.lastSoundPoint[1] + changes[1] * distance, this.lastSoundPoint[2] + changes[2] * distance]
			}
		}
		if (this.shinyBlockOverlayEnabled.getValue() && this.FeatureManager.features["dataLoader"].class.areaFine === "The End") {
			if (particle.toString().startsWith("EntitySpellParticleFX,")) {
				if (particle.getUnderlyingEntity().func_70534_d() === particle.getUnderlyingEntity().func_70535_g()) {
					let arr = [particle.getX(), particle.getY(), particle.getZ()]
					if (arr.map(a => Math.abs(a % 1)).includes(0.25) || arr.map(a => Math.abs(a % 1)).includes(0.75)) {
						this.shinyBlocks.push([[particle.getX(), particle.getY(), particle.getZ()], Date.now()])
					}
				}
			}
		}
		if (this.showingWaypoints && this.loadFromParticles.getValue()) {
			let foundEnchant = false
			let foundCrit = false
			let foundStep = false
			let isMob = undefined

			if (particle.toString().startsWith('EntityEnchantmentTableParticleFX, ')) {
				foundEnchant = true
			}
			else if (particle.toString().startsWith('EntityCrit2FX, ')) {
				foundCrit = true

				isMob = particle.getUnderlyingEntity().func_70534_d() > 0.5 //mob)
			}
			else if (particle.toString().startsWith('EntityFootStepFX, ')) {
				foundStep = true
			}
			else if (particle.toString().startsWith('EntityCritFX, ')) {

				let locstr = Math.floor(particle.getX()) + "," + Math.floor(particle.getY() - 1) + "," + Math.floor(particle.getZ())

				let removed = false
				this.burrialData.locations.filter((loc, i) => {
					if (!loc.clicked && loc.x + "," + loc.y + "," + loc.z === locstr) {
						loc.clicked = true
						removed = true
					}
				})
				if (!removed) return;
				this.burrialData.locations = this.burrialData.locations.filter(a => {
					if (!a.clicked) return true
					if (calculateDistanceQuick([a.x, a.y, a.z], [Player.getX(), Player.getY(), Player.getZ()]) < 15 * 15) return true;

					this.burrialData.historicalLocations.unshift(a)

					return false
				})
				if (this.burrialData.historicalLocations.length > 10) this.burrialData.historicalLocations.pop()

				return;
			}

			if (!foundEnchant && !foundCrit && !foundStep) return;

			if (Math.abs(particle.getY() % 1) > 0.1) return
			if (Math.abs(particle.getX() % 1) < 0.1) return
			if (Math.abs(particle.getX() % 1) > 0.9) return
			if (Math.abs(particle.getZ() % 1) < 0.1) return
			if (Math.abs(particle.getZ() % 1) > 0.9) return

			let locstr = Math.floor(particle.getX()) + "," + Math.floor(particle.getY() - 1) + "," + Math.floor(particle.getZ())
			let locarr = [Math.floor(particle.getX()), Math.floor(particle.getY() - 1), Math.floor(particle.getZ())]

			let found = false

			this.burrialData.locations.forEach((loc) => {
				if (loc.x + "," + loc.y + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x + 1) + "," + loc.y + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x + 1) + "," + (loc.y + 1) + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x + 1) + "," + (loc.y - 1) + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x - 1) + "," + (loc.y + 1) + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x - 1) + "," + (loc.y - 1) + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if ((loc.x - 1) + "," + loc.y + "," + loc.z === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if (loc.x + "," + loc.y + "," + (loc.z + 1) === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
				if (loc.x + "," + loc.y + "," + (loc.z - 1) === locstr) {
					found = loc
					loc.lastPing = Date.now()
				}
			})
			if (this.burrialData.historicalLocations) {
				this.burrialData.historicalLocations.forEach((loc) => {
					if (loc.x + "," + loc.y + "," + loc.z === locstr) {
						found = loc
					}
				})
			}

			if (!this.potentialParticleLocs[locstr] || Date.now() - this.potentialParticleLocs[locstr].timestamp > 30000) this.potentialParticleLocs[locstr] = { enchant: 0, crit: 0, step: 0, isMob: 0, timestamp: Date.now() }

			if (foundEnchant) this.potentialParticleLocs[locstr].enchant++
			if (foundCrit) this.potentialParticleLocs[locstr].crit++
			if (foundStep) this.potentialParticleLocs[locstr].step++
			if (foundCrit && isMob) this.potentialParticleLocs[locstr].isMob++
			if (foundCrit && !isMob) this.potentialParticleLocs[locstr].isMob--

			this.potentialParticleLocs[locstr].timestamp = Date.now()

			if (this.potentialParticleLocs[locstr].enchant >= 1 && this.potentialParticleLocs[locstr].step >= 2) {
				if (found) {
					found.type = this.potentialParticleLocs[locstr].isMob >= 1 ? 1 : (this.potentialParticleLocs[locstr].crit > this.potentialParticleLocs[locstr].enchant / 20 ? 0 : 2)
					return
				}
				this.burrialData.locations.push({
					"x": locarr[0],
					"y": locarr[1],
					"z": locarr[2],
					"type": this.potentialParticleLocs[locstr].isMob >= 1 ? 1 : (this.potentialParticleLocs[locstr].crit > this.potentialParticleLocs[locstr].enchant / 20 ? 0 : 2),
					"tier": -1,
					"chain": -1,
					"fromApi": false
				})
				World.playSound("note.pling", 100, 2)
			}
		}
	}

	burrialClicked() {
		if (this.inquisWaypointSpawned) {
			socketConnection.sendInquisData({ loc: null });
			this.inquisWaypointSpawned = false
		}
		if (!this.showingWaypoints) return

		let nearestBurriali = undefined
		let nearestBurrialDist = Infinity

		this.burrialData.locations.forEach((loc, i) => {
			let dist = calculateDistanceQuick([loc.x, loc.y, loc.z], [Player.getX(), Player.getY(), Player.getZ()])
			if (dist < nearestBurrialDist) {
				nearestBurrialDist = dist
				nearestBurriali = i
			}
		})

		if (nearestBurriali === undefined) return;
		this.burrialData.locations[nearestBurriali].clicked = true

		this.burrialData.locations = this.burrialData.locations.filter(a => {
			if (!a.clicked) return true
			if (calculateDistanceQuick([a.x, a.y, a.z], [Player.getX(), Player.getY(), Player.getZ()]) < 15 * 15) return true;

			this.burrialData.historicalLocations.unshift(a)

			return false
		})
		if (this.burrialData.historicalLocations.length > 10) this.burrialData.historicalLocations.pop()
		if (this.lastPathCords) this.lastPathCords.shift()
	}

	initVariables() {
		this.burrialData = undefined
		this.potentialParticleLocs = undefined
		this.showingWaypoints = undefined
		this.lastPath = undefined
		this.updatingPath = undefined
		this.lastPathCords = undefined
	}

	onDisable() {
		this.initVariables()
	}
}

module.exports = {
	class: new Events()
}