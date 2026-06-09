import { AgentOSConfig } from './types';

export class AgentOS {
  private config: AgentOSConfig;

  constructor(config: AgentOSConfig) {
    this.config = config;
  }

  getConfig(): Readonly<AgentOSConfig> {
    return this.config;
  }
}
