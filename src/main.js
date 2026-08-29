/** Boot: create the game and start the loop. */
import { Game } from './core/Game.js';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

const game = new Game(document.getElementById('c'));
game.start();

// Android hardware back: close the map, else toggle the pause menu, else background the app —
// never let the WebView kill a run. Inert in the browser (isNativePlatform() is false there).
if (Capacitor.isNativePlatform()) {
  CapApp.addListener('backButton', () => {
    if (game.map.isOpen) game.map.close();
    else if (game.state === 'EXPEDITION') game.menus.togglePause();
    else CapApp.minimizeApp();
  });
}
