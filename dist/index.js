import { SanGuoGame } from "./engine/game.js";
import { CliSanGuoApp } from "./ui/app.js";
const main = async () => {
    const app = new CliSanGuoApp(new SanGuoGame());
    await app.start();
};
void main();
