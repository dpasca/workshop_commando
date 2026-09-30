import { defineConfig } from "vite";
import { workshopData } from "./server/workshopData";

export default defineConfig({
  plugins: [workshopData()],
});
