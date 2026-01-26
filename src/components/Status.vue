<template>
    <span class="badge rounded-pill" :class="'bg-' + color">{{ text }}</span>
</template>

<script>
import { DOWN, UP, PENDING, MAINTENANCE, RESTARTING } from "../util.ts";

export default {
    props: {
        /** Current status of monitor */
        status: {
            type: Number,
            default: 0,
        },
    },

    computed: {
        color() {
            const status = Number(this.status);
            if (!Number.isFinite(status)) {
                return "secondary";
            }
            if (status === DOWN) {
                return "danger";
            }

            if (status === UP) {
                return "primary";
            }

            if (status === PENDING) {
                return "warning";
            }

            if (status === MAINTENANCE) {
                return "maintenance";
            }

            if (status === RESTARTING) {
                return "restarting";
            }

            return "secondary";
        },

        text() {
            const status = Number(this.status);
            if (!Number.isFinite(status)) {
                return this.$t("Unknown");
            }
            if (status === DOWN) {
                return this.$t("Down");
            }

            if (status === UP) {
                return this.$t("Up");
            }

            if (status === PENDING) {
                return this.$t("Pending");
            }

            if (status === MAINTENANCE) {
                return this.$t("statusMaintenance");
            }

            if (status === RESTARTING) {
                return this.$t("Restarting");
            }

            return this.$t("Unknown");
        },
    },
};
</script>

<style scoped>
span {
    min-width: 64px;
}
</style>
