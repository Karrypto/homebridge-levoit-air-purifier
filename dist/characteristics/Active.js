"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("../util");
const characteristic = {
    get: async function () {
        await this.device.updateInfo();
        // Always return 0 or 1, never undefined
        return this.device.isOn ? 1 : 0;
    },
    set: async function (value) {
        let boolValue = value === 1;
        if (boolValue !== this.device.isOn) {
            const success = await this.device.setPower(boolValue);
            if (!success) {
                boolValue = !boolValue;
            }
        }
        else {
            await (0, util_1.delay)(10);
        }
        const { PURIFYING_AIR, INACTIVE } = this.platform.Characteristic.CurrentAirPurifierState;
        this.airPurifierCurrentCharacteristic.updateValue(boolValue ? PURIFYING_AIR : INACTIVE);
    }
};
exports.default = characteristic;
//# sourceMappingURL=Active.js.map