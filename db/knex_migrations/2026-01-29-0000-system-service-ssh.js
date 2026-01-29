/**
 * @param {import("knex").Knex} knex The Knex.js instance for database interaction.
 * @returns {Promise<void>}
 */
exports.up = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.string("system_service_check_method");
        table.string("system_service_ssh_url");
        table.string("system_service_ssh_platform");
    });
};

/**
 * @param {import("knex").Knex} knex The Knex.js instance for database interaction.
 * @returns {Promise<void>}
 */
exports.down = async (knex) => {
    await knex.schema.alterTable("monitor", (table) => {
        table.dropColumn("system_service_check_method");
        table.dropColumn("system_service_ssh_url");
        table.dropColumn("system_service_ssh_platform");
    });
};
