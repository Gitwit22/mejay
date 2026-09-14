/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_URL?: string
	readonly VITE_USE_SAME_ORIGIN_API?: string
	readonly VITE_DEV_BYPASS_AUTH?: string
	readonly VITE_AUTH_BYPASS?: string
	readonly VITE_AUTH_BYPASS_TOGGLE?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
