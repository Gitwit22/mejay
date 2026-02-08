/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_DEV_BYPASS_AUTH?: string
	readonly VITE_AUTH_BYPASS?: string
	readonly VITE_AUTH_BYPASS_TOGGLE?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
