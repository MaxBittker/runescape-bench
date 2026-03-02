/**
 * freshStart(sdk, bot) — reset a connected bot to the GP benchmark starting state.
 *
 * Handles Tutorial Island / character creation automatically.
 * Uses cheat commands (::setstat, ::give, ::unstuck) for skill/item setup.
 *
 * IMPORTANT: Pass sdk and bot explicitly — they are execute_code globals,
 * not available in module scope.
 *
 * Usage inside execute_code:
 *
 *   const { freshStart } = await import('/app/benchmark/shared/gp_fresh_start.ts');
 *   await freshStart(sdk, bot);
 *   // Bot is now at Lumbridge, level 50 all skills (55 Magic), with starting gear
 */

const SKILLS_TO_SET: Array<[string, number]> = [
    ['attack',      50],
    ['defence',     50],
    ['strength',    50],
    ['hitpoints',   50],
    ['magic',       55],  // 55 = High Level Alchemy
    ['ranged',      50],
    ['prayer',      50],
    ['woodcutting', 50],
    ['fishing',     50],
    ['mining',      50],
    ['cooking',     50],
    ['crafting',    50],
    ['smithing',    50],
    ['firemaking',  50],
    ['fletching',   50],
    ['thieving',    50],
    ['runecrafting',50],
    ['herblore',    50],
    ['agility',     50],
];

const ITEMS_TO_GIVE: Array<[string, number]> = [
    ['rune_axe',        1],
    ['knife',           1],
    ['tinderbox',       1],
    ['small_fishing_net', 1],
    ['hammer',          1],
    ['nature_rune',     1000],
];

const STAFF_OF_FIRE_ID = 1387;
const STAFF_OF_FIRE_NAME = 'staff_of_fire';

// Tutorial Island bounds
function isOnTutorialIsland(x: number, z: number): boolean {
    return x >= 3050 && x <= 3156 && z >= 3056 && z <= 3136;
}

export async function freshStart(sdk: any, bot: any): Promise<void> {
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    console.log('[freshStart] Starting...');

    // --- Phase 0: Wait for initial state ---
    let state = sdk.getState();
    for (let i = 0; i < 30 && !state?.player; i++) {
        await sleep(500);
        state = sdk.getState();
    }
    if (!state?.player) {
        console.warn('[freshStart] WARNING: No player state after 15s, proceeding anyway');
    }

    // --- Phase 1: Handle character creation screen (interface 3559) ---
    state = sdk.getState();
    if (state?.interface?.id === 3559) {
        console.log('[freshStart] Character creation screen detected — accepting...');
        // Try clicking "Accept" (option 1) in the interface
        const acceptOption = state.interface.options?.[0];
        if (acceptOption?.componentId) {
            await sdk.sendClickComponent(acceptOption.componentId);
        } else {
            // Fallback: try sendCloseModal or sendClickDialog
            try { await sdk.sendCloseModal(); } catch {}
        }
        await sleep(3000);
    }

    // --- Phase 2: Skip Tutorial Island if needed ---
    state = sdk.getState();
    const px = state?.player?.worldX ?? 0;
    const pz = state?.player?.worldZ ?? 0;

    if (isOnTutorialIsland(px, pz)) {
        console.log('[freshStart] On Tutorial Island — skipping tutorial...');
        for (let attempt = 0; attempt < 30; attempt++) {
            try {
                await bot.skipTutorial();
            } catch (e: any) {
                // skipTutorial errors are expected mid-transition — keep trying
            }
            await sleep(1000);
            state = sdk.getState();
            const x = state?.player?.worldX ?? 0;
            const z = state?.player?.worldZ ?? 0;
            if (!isOnTutorialIsland(x, z)) {
                console.log(`[freshStart] Left Tutorial Island → (${x}, ${z})`);
                break;
            }
        }
        await sleep(2000);
    }

    // --- Phase 3: Teleport to Lumbridge ---
    await sdk.sendSay('::unstuck');
    await sleep(1500);
    console.log('[freshStart] Teleported to Lumbridge');

    // --- Phase 4: Set all skills ---
    for (const [skill, level] of SKILLS_TO_SET) {
        await sdk.sendSay(`::setstat ${skill} ${level}`);
        await sleep(150);
    }
    console.log('[freshStart] Skills set to level 50 (Magic 55)');

    // --- Phase 5: Clear inventory ---
    await sleep(500);
    const inv = sdk.getInventory();
    for (let i = inv.length - 1; i >= 0; i--) {
        await sdk.sendDropItem(i);
        await sleep(100);
    }
    console.log('[freshStart] Inventory cleared');

    // --- Phase 6: Give starting items ---
    for (const [item, count] of ITEMS_TO_GIVE) {
        await sdk.sendSay(`::give ${item} ${count}`);
        await sleep(150);
    }
    console.log('[freshStart] Starting items given');

    // --- Phase 7: Give and equip staff of fire ---
    await sdk.sendSay(`::give ${STAFF_OF_FIRE_NAME} 1`);
    await sleep(1000);
    const staffSlot = sdk.getInventory().findIndex((i: any) => i.id === STAFF_OF_FIRE_ID);
    if (staffSlot !== -1) {
        await bot.equipItem(STAFF_OF_FIRE_ID);
        await sleep(500);
        console.log('[freshStart] Staff of fire equipped');
    } else {
        console.warn('[freshStart] WARNING: Staff of fire not found');
    }

    // --- Phase 8: Verify final state ---
    await sleep(500);
    state = sdk.getState();
    const skills = sdk.getSkills();
    const atk = skills.find((s: any) => s.name.toUpperCase() === 'ATTACK');
    const magic = skills.find((s: any) => s.name.toUpperCase() === 'MAGIC');
    const pos = `(${state?.player?.worldX}, ${state?.player?.worldZ})`;

    console.log(`[freshStart] Done. Pos=${pos} Attack=${atk?.baseLevel} Magic=${magic?.baseLevel} Inv=${sdk.getInventory().length} items`);

    if (!atk || atk.baseLevel < 50) {
        console.warn('[freshStart] WARNING: Attack level wrong:', atk?.baseLevel);
    }
}
