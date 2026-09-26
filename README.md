# Feastfall

A first-person, low-poly battle royale that runs in the browser. Drop into a forest, desert, mountain and swamp map with up to 99 other fighters, gather and craft, build towers and traps, and be the last one standing. There's no mindless pointing: you win by reading the map, managing potions and using height.

- **Towers and falls.** Craft planks and cobblestone, place blocks, pillar-jump up and shoot from above. Fall damage is real, so knockback, grappling hooks and lightning all bring towers down.
- **Four ways to play.** Hunt people, mine rats in the tunnels for armour, set spike traps near the swamp, or tower up.
- **14 kits** on a weekly free rotation: Killer, Mage, Jumper, Runner, Puncher, Thrower, Faller, Cutter, Hidden, Faker, Finder, Lightning, Heavy, Fisherman.
- **A 60-minute match.** Grace period, a feast at 25:00 with the best gear, and at 60:00 everyone left is dropped into the pit.
- **Online multiplayer** for up to 16 players plus bots, through a small relay server included here.
- **Everything is generated in code:** the low-poly world, the item icons and the ambient music and sound effects. There are no asset files.

## Play

### Solo (no install)

Serve the folder with any static file server and open it in a desktop browser (you need a keyboard and mouse):

```bash
npx serve .
```

or `python -m http.server 8000`. Opening `index.html` straight from disk won't work, because browsers block scripts on `file://` pages.

Solo play also works on **GitHub Pages**: push the repository and turn on Pages for the main branch.

### Online with friends

```bash
npm install
npm start
```

Open `http://localhost:8080`. The page connects back to the same server, so everyone who opens that address shares a lobby. One player clicks **Host a match**, everyone else clicks **Join**, and the host starts it. To play over the internet, run the server on any Node host (Render, Fly.io, Railway, a VPS) and share its address. Set `PORT` to change the port.

To keep the page on GitHub Pages and run only the server elsewhere, set the server address in `config.js`:

```js
window.FEASTFALL_SERVER = 'wss://your-server.example.com/ws';
```

or add it to the link for one visit: `https://you.github.io/feastfall/?server=wss://your-server.example.com/ws`.

For a quick test without a server, open the page on `localhost` in two tabs of the same browser: they find each other through a local channel.

## Controls

| Key | Action |
| --- | --- |
| WASD · mouse | Move · look (click the game to capture the mouse) |
| Space · Shift | Jump · sneak (you won't walk off edges, and it blocks Faller damage) |
| Left click | Swing (hold to keep swinging), hold on a block to break it, draw the bow, use the held item |
| Right click | Place the held block (hold, jump and look down to tower up), otherwise drink |
| 1–9 · wheel | Select a hotbar slot |
| Tab | Inventory and crafting |
| Q · F · R | Kit ability · drink · refill the hotbar with potions from your backpack |
| E | Enter or leave a tunnel; hold to chop, mine or cut reeds |
| G · Ctrl+G | Drop one of the held item · drop the whole stack |
| T | Chat (online) |
| Esc | Release the mouse and pause |

In the inventory: click to pick up and put down, right-click to split a stack, shift-click to move items or put on armour, and hover over a slot and press 1–9 to swap it into the hotbar.

## How it's built

Plain JavaScript, no build step. [three.js](https://threejs.org/) r128 is loaded from cdnjs, and fonts come from Google Fonts.

| File | What it does |
| --- | --- |
| `index.html` | Page, HUD, menus and styles |
| `config.js` | Where online play connects |
| `js/world.js` | Seeded map: biomes, trees, rocks, reeds, tunnels |
| `js/blocks.js` | Placeable blocks, collision, fall support, raycasting |
| `js/items.js` | Item registry, drawn icons, inventory, armour, recipes |
| `js/entities.js` | Fighters, combat, kits, falling, traps, rats, projectiles, ground items |
| `js/bots.js` | Bot playstyles: hunter, miner, trapper, tower, balanced |
| `js/net.js` | Online play: lobby, matches, state sync, host migration |
| `js/scene3d.js` | Renderer, lights, terrain mesh, instanced scenery, tunnels |
| `js/view3d.js` | Per-frame 3D: players, items, effects, first-person held item, minimap |
| `js/audio.js` | Generated ambient music and positional sound effects |
| `js/main.js` | Game loop, input, HUD, inventory screen, menus, kit store |
| `server.js` | Static file server plus a WebSocket relay for multiplayer |

### Multiplayer model

Each player's browser runs their own character and shares its state about 10 times a second. The player who hosts a match also runs the bots, the clock, potions, feast chests and item pickups. Hits, block edits, deaths and item changes are sent as messages, and the browser that runs a fighter applies damage to it. If the host leaves, the next player takes over the bots and the match continues. The server only relays messages between players in the same room; it knows nothing about the game.

Because the clients are trusted, a modified client could cheat. That's fine for playing with friends. A public server would need the game rules to move onto the server.

## Known limits

- You can't join a match that's already running.
- Rats in the tunnels are separate for each player (their hide drops are real).
- On a bad connection a block edit or hit can occasionally be lost.
- 99 bots needs a fast computer. Turn shadows off in Options if it runs slowly.
- Money purchases in the kit store aren't implemented. Kits unlock with coins earned in matches.

## License

No license has been chosen yet. Until one is added, all rights are reserved by the author.
